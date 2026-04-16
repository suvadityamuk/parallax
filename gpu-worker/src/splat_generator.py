"""3D Gaussian Splat generation from depth maps.

Pipeline:
1. Depth + RGB + FG mask → 3D point cloud via pinhole camera unprojection
2. Voxel grid downsampling to control splat count
3. Point cloud → Gaussian splat parameters (position, color, scale, opacity, rotation)
4. Delta encoding between frames (only changed splats emitted)

Output format compatible with gsplat.js / standard 3DGS renderers.
"""

import numpy as np
from . import config

# Cache for delta encoding
_prev_splats: dict | None = None
_frame_count: int = 0


def reset():
    """Reset generator state (new call, mode change)."""
    global _prev_splats, _frame_count
    _prev_splats = None
    _frame_count = 0


def depth_to_pointcloud(
    depth_map: np.ndarray,
    frame_rgb: np.ndarray,
    fg_mask: np.ndarray,
) -> dict:
    """Convert depth map + RGB to a colored 3D point cloud.

    Uses a pinhole camera model with the configured focal length.

    Args:
        depth_map: (H, W) float32, values in [0, 1] (0=close, 1=far).
        frame_rgb: (H, W, 3) uint8 RGB.
        fg_mask: (H, W) float32, 1.0=FG, 0.0=BG.

    Returns:
        dict with:
            positions: (N, 3) float32 — xyz in camera space
            colors: (N, 3) float32 — RGB normalized [0, 1]
            is_foreground: (N,) bool
    """
    h, w = depth_map.shape
    fx = fy = config.FOCAL_LENGTH_PX
    cx, cy = w / 2.0, h / 2.0

    # Create pixel coordinate grids
    u, v = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))

    # Map depth from [0,1] to metric-like range [0.3, 5.0] meters
    z = 0.3 + depth_map * 4.7  # 0=close→0.3m, 1=far→5.0m

    # Unproject to 3D
    x = (u - cx) * z / fx
    y = (v - cy) * z / fy

    # Flatten
    positions = np.stack([x, y, z], axis=-1).reshape(-1, 3)
    colors = frame_rgb.reshape(-1, 3).astype(np.float32) / 255.0
    is_fg = fg_mask.reshape(-1) > 0.5

    return {
        "positions": positions,
        "colors": colors,
        "is_foreground": is_fg,
    }


def voxel_downsample(
    positions: np.ndarray,
    colors: np.ndarray,
    is_fg: np.ndarray,
    voxel_size: float | None = None,
    max_count: int | None = None,
) -> dict:
    """Downsample point cloud using a voxel grid filter.

    Groups points into voxels and averages within each voxel.

    Args:
        positions: (N, 3) float32
        colors: (N, 3) float32
        is_fg: (N,) bool
        voxel_size: Side length of each voxel. If None, uses config.
        max_count: Max number of output points. If None, uses config.

    Returns:
        dict with downsampled positions, colors, is_foreground.
    """
    if voxel_size is None:
        voxel_size = config.SPLAT_VOXEL_SIZE
    if max_count is None:
        max_count = config.SPLAT_MAX_COUNT

    # Quantize positions to voxel grid
    voxel_indices = np.floor(positions / voxel_size).astype(np.int32)

    # Create unique voxel keys using Cantor-like hashing
    # Shift to positive range first
    mins = voxel_indices.min(axis=0)
    shifted = voxel_indices - mins
    maxes = shifted.max(axis=0) + 1

    keys = (shifted[:, 0] * maxes[1] * maxes[2] +
            shifted[:, 1] * maxes[2] +
            shifted[:, 2])

    # Find unique voxels and average their contents
    unique_keys, inverse = np.unique(keys, return_inverse=True)
    n_voxels = len(unique_keys)

    # Accumulate per-voxel
    out_pos = np.zeros((n_voxels, 3), dtype=np.float64)
    out_col = np.zeros((n_voxels, 3), dtype=np.float64)
    out_fg = np.zeros(n_voxels, dtype=np.float64)
    counts = np.zeros(n_voxels, dtype=np.float64)

    np.add.at(out_pos, inverse, positions.astype(np.float64))
    np.add.at(out_col, inverse, colors.astype(np.float64))
    np.add.at(out_fg, inverse, is_fg.astype(np.float64))
    np.add.at(counts, inverse, 1.0)

    counts_safe = np.maximum(counts, 1.0)
    out_pos /= counts_safe[:, np.newaxis]
    out_col /= counts_safe[:, np.newaxis]
    out_fg = (out_fg / counts_safe) > 0.5

    # If still too many, randomly subsample
    if n_voxels > max_count:
        indices = np.random.choice(n_voxels, max_count, replace=False)
        out_pos = out_pos[indices]
        out_col = out_col[indices]
        out_fg = out_fg[indices]

    return {
        "positions": out_pos.astype(np.float32),
        "colors": out_col.astype(np.float32),
        "is_foreground": out_fg.astype(bool),
    }


def pointcloud_to_splats(
    positions: np.ndarray,
    colors: np.ndarray,
    is_fg: np.ndarray,
) -> dict:
    """Convert a point cloud to Gaussian Splat parameters.

    Each point becomes an isotropic Gaussian with:
    - position: xyz
    - color: RGB as SH0 (band-0 spherical harmonic = DC component)
    - scale: proportional to depth (farther = larger for coverage)
    - opacity: 1.0 for FG, 0.6 for BG
    - rotation: identity quaternion [1, 0, 0, 0]

    Args:
        positions: (N, 3) float32
        colors: (N, 3) float32 [0, 1]
        is_fg: (N,) bool

    Returns:
        dict with splat arrays, all (N, ...) float32.
    """
    n = len(positions)

    # Scale proportional to z-depth (farther = bigger splats)
    depths = positions[:, 2]
    scales = np.clip(depths * 0.008, 0.003, 0.05)  # (N,)
    scales_3d = np.stack([scales, scales, scales], axis=-1)  # Isotropic

    # Opacity: FG fully opaque, BG slightly transparent
    opacities = np.where(is_fg, 1.0, 0.6).astype(np.float32)

    # Rotation: identity quaternion [w, x, y, z]
    rotations = np.zeros((n, 4), dtype=np.float32)
    rotations[:, 0] = 1.0  # w = 1

    # SH0 coefficients (DC component) from RGB
    # gsplat convention: SH0 = color * sqrt(4π) for proper rendering
    sh0 = colors * np.sqrt(4.0 * np.pi)

    return {
        "positions": positions,
        "colors": colors,
        "sh0": sh0,
        "scales": scales_3d,
        "opacities": opacities,
        "rotations": rotations,
    }


def compute_delta(
    current: dict,
    previous: dict,
    threshold: float | None = None,
) -> dict:
    """Compute delta between two splat frames.

    Only splats whose position changed by more than `threshold` are included.

    Args:
        current: Current frame splats dict.
        previous: Previous frame splats dict.
        threshold: Position change threshold. If None, uses config.

    Returns:
        Delta dict with changed splat indices and new values.
    """
    if threshold is None:
        threshold = config.DELTA_THRESHOLD

    curr_pos = current["positions"]
    prev_pos = previous["positions"]

    # Handle different sizes (just send keyframe if counts differ significantly)
    if abs(len(curr_pos) - len(prev_pos)) > len(curr_pos) * 0.2:
        return None  # Signal: send keyframe instead

    # Use the smaller size
    n = min(len(curr_pos), len(prev_pos))
    pos_diff = np.linalg.norm(curr_pos[:n] - prev_pos[:n], axis=1)
    changed = pos_diff > threshold

    if changed.sum() == 0:
        # Nothing changed — send empty delta
        return {
            "indices": np.array([], dtype=np.int32),
            "positions": np.array([], dtype=np.float32).reshape(0, 3),
            "colors": np.array([], dtype=np.float32).reshape(0, 3),
            "scales": np.array([], dtype=np.float32).reshape(0, 3),
            "opacities": np.array([], dtype=np.float32),
        }

    indices = np.where(changed)[0].astype(np.int32)

    return {
        "indices": indices,
        "positions": current["positions"][indices],
        "colors": current["colors"][indices],
        "scales": current["scales"][indices],
        "opacities": current["opacities"][indices],
    }


def generate(
    depth_map: np.ndarray,
    frame_bgr: np.ndarray,
    fg_mask: np.ndarray,
) -> dict:
    """Full pipeline: depth + RGB + mask → splats (keyframe or delta).

    Args:
        depth_map: (H, W) float32, [0, 1].
        frame_bgr: (H, W, 3) uint8 BGR.
        fg_mask: (H, W) float32, 1.0=FG.

    Returns:
        dict with:
            type: "keyframe" or "delta"
            splats: splat data dict (full or delta)
            splat_count: total number of splats
            fg_ratio: fraction that is foreground
    """
    global _prev_splats, _frame_count
    import cv2

    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    # 1. Depth → point cloud
    pc = depth_to_pointcloud(depth_map, frame_rgb, fg_mask)

    # 2. Voxel downsample
    pc = voxel_downsample(pc["positions"], pc["colors"], pc["is_foreground"])

    # 3. Point cloud → splats
    splats = pointcloud_to_splats(pc["positions"], pc["colors"], pc["is_foreground"])

    fg_count = pc["is_foreground"].sum()
    total = len(pc["positions"])
    fg_ratio = float(fg_count / max(total, 1))

    _frame_count += 1
    is_keyframe = (
        _prev_splats is None or
        _frame_count % int(config.KEYFRAME_INTERVAL_S * 10) == 0  # ~every 3s at 10fps
    )

    if is_keyframe:
        _prev_splats = splats
        return {
            "type": "keyframe",
            "splats": _serialize_splats(splats),
            "splat_count": total,
            "fg_ratio": fg_ratio,
        }

    # 4. Delta encoding
    delta = compute_delta(splats, _prev_splats)
    _prev_splats = splats

    if delta is None:
        # Too different — send keyframe
        return {
            "type": "keyframe",
            "splats": _serialize_splats(splats),
            "splat_count": total,
            "fg_ratio": fg_ratio,
        }

    return {
        "type": "delta",
        "splats": _serialize_delta(delta),
        "splat_count": total,
        "fg_ratio": fg_ratio,
        "changed_count": len(delta["indices"]),
    }


def _serialize_splats(splats: dict) -> dict:
    """Convert numpy arrays to lists for JSON serialization."""
    return {
        "positions": splats["positions"].tolist(),
        "colors": splats["colors"].tolist(),
        "scales": splats["scales"].tolist(),
        "opacities": splats["opacities"].tolist(),
        "rotations": splats["rotations"].tolist(),
    }


def _serialize_delta(delta: dict) -> dict:
    """Convert delta numpy arrays to lists for JSON serialization."""
    return {
        "indices": delta["indices"].tolist(),
        "positions": delta["positions"].tolist(),
        "colors": delta["colors"].tolist(),
        "scales": delta["scales"].tolist(),
        "opacities": delta["opacities"].tolist(),
    }
