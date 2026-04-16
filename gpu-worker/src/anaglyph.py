"""Anaglyph compositing module.

Pipeline:
1. Depth map → per-pixel disparity
2. DIBR (Depth-Image-Based Rendering) warp → left/right eye views
3. Dubois matrix compositing → final anaglyph frame

Supports 4 glasses types with optimized Dubois matrices for reduced ghosting.
"""

import numpy as np
import cv2
from . import config

# ─── Dubois Anaglyph Matrices ──────────────────────────────────────────────
# These are optimized color matrices from Eric Dubois (2001, 2009) that
# minimize ghosting and preserve color accuracy for each glasses type.
# Each pair is (left_eye_matrix, right_eye_matrix), applied as:
#   output = left_matrix @ left_rgb + right_matrix @ right_rgb

DUBOIS_MATRICES = {
    "red_cyan": {
        "left": np.array([
            [0.4561, 0.500484, 0.176381],
            [-0.0400822, -0.0378246, -0.0157589],
            [-0.0152161, -0.0205971, -0.00546856],
        ], dtype=np.float32),
        "right": np.array([
            [-0.0434706, -0.0879388, -0.00155529],
            [0.378476, 0.73364, -0.0184503],
            [-0.0721527, -0.112961, 1.2264],
        ], dtype=np.float32),
    },
    "red_blue": {
        "left": np.array([
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
        ], dtype=np.float32),
        "right": np.array([
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        ], dtype=np.float32),
    },
    "green_magenta": {
        "left": np.array([
            [-0.062, -0.158, -0.039],
            [0.284, 0.668, 0.143],
            [-0.015, -0.027, 0.021],
        ], dtype=np.float32),
        "right": np.array([
            [0.529, 0.705, 0.024],
            [-0.016, -0.015, -0.065],
            [0.009, 0.075, 0.937],
        ], dtype=np.float32),
    },
    "amber_blue": {
        "left": np.array([
            [1.062, -0.205, 0.299],
            [-0.026, 0.908, 0.068],
            [-0.038, -0.173, 0.022],
        ], dtype=np.float32),
        "right": np.array([
            [-0.016, -0.123, -0.017],
            [0.006, 0.062, -0.017],
            [0.094, 0.185, 0.911],
        ], dtype=np.float32),
    },
}


def depth_to_disparity(depth_map: np.ndarray) -> np.ndarray:
    """Convert normalized depth [0=close,1=far] to pixel disparity.

    Closer objects get larger disparity (more stereo separation).

    Args:
        depth_map: (H, W) float32, values in [0, 1].

    Returns:
        disparity: (H, W) float32, values in [-max_disp, +max_disp].
    """
    max_disp = config.MAX_DISPARITY_PX
    # Invert: close objects (depth≈0) should have high disparity
    # Linear mapping: depth 0 → +max_disp, depth 1 → -max_disp/4 (slight behind-screen)
    disparity = max_disp * (1.0 - depth_map * 1.25)
    return disparity.astype(np.float32)


def dibr_warp(frame_bgr: np.ndarray, disparity: np.ndarray, direction: float) -> np.ndarray:
    """Depth-Image-Based Rendering warp for one eye.

    Shifts each pixel horizontally by disparity * direction.

    Args:
        frame_bgr: (H, W, 3) uint8 source frame.
        disparity: (H, W) float32 per-pixel disparity.
        direction: -1.0 for left eye, +1.0 for right eye.

    Returns:
        Warped frame (H, W, 3) uint8.
    """
    h, w = frame_bgr.shape[:2]

    # Create remap coordinates
    # For each output pixel (x, y), sample from (x + disp * direction, y)
    shift = disparity * direction * 0.5  # Half-shift per eye

    map_x = np.arange(w, dtype=np.float32)[np.newaxis, :] - shift
    map_y = np.arange(h, dtype=np.float32)[:, np.newaxis] * np.ones((1, w), dtype=np.float32)

    # Remap with bilinear interpolation
    warped = cv2.remap(
        frame_bgr,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )

    return warped


def composite_anaglyph(
    frame_bgr: np.ndarray,
    depth_map: np.ndarray,
    glasses_type: str = "red_cyan",
) -> np.ndarray:
    """Create an anaglyph 3D image from a frame and its depth map.

    Pipeline:
    1. Depth → disparity map
    2. DIBR warp → left eye view and right eye view
    3. Dubois matrix compositing → anaglyph output

    Args:
        frame_bgr: (H, W, 3) uint8 BGR input frame.
        depth_map: (H, W) float32 normalized depth [0=close, 1=far].
        glasses_type: One of 'red_cyan', 'red_blue', 'green_magenta', 'amber_blue'.

    Returns:
        Anaglyph frame (H, W, 3) uint8 BGR.
    """
    if glasses_type not in DUBOIS_MATRICES:
        glasses_type = "red_cyan"

    matrices = DUBOIS_MATRICES[glasses_type]

    # Step 1: depth → disparity
    disparity = depth_to_disparity(depth_map)

    # Step 2: DIBR warp for each eye
    left_view = dibr_warp(frame_bgr, disparity, direction=-1.0)
    right_view = dibr_warp(frame_bgr, disparity, direction=1.0)

    # Step 3: Convert to RGB float [0, 1] for matrix multiplication
    left_rgb = cv2.cvtColor(left_view, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    right_rgb = cv2.cvtColor(right_view, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0

    # Apply Dubois matrices: output_rgb = M_left @ left_rgb + M_right @ right_rgb
    h, w = left_rgb.shape[:2]
    left_flat = left_rgb.reshape(-1, 3)   # (H*W, 3)
    right_flat = right_rgb.reshape(-1, 3)

    anaglyph_flat = (left_flat @ matrices["left"].T) + (right_flat @ matrices["right"].T)

    # Clamp and convert back to uint8 BGR
    anaglyph_rgb = np.clip(anaglyph_flat.reshape(h, w, 3), 0.0, 1.0)
    anaglyph_bgr = (cv2.cvtColor(
        (anaglyph_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2BGR
    ))

    return anaglyph_bgr
