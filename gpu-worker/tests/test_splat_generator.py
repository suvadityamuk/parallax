"""Unit tests for the splat generation pipeline.

Tests depth→pointcloud, voxel downsampling, splat conversion, and delta encoding.
"""

import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from src.splat_generator import (
    depth_to_pointcloud,
    voxel_downsample,
    pointcloud_to_splats,
    compute_delta,
    reset,
    generate,
)


def test_depth_to_pointcloud_shape():
    """Point cloud should have N points with 3D positions and RGB colors."""
    h, w = 100, 100
    depth_map = np.random.rand(h, w).astype(np.float32)
    frame_rgb = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    fg_mask = np.ones((h, w), dtype=np.float32)

    pc = depth_to_pointcloud(depth_map, frame_rgb, fg_mask)

    assert pc["positions"].shape == (h * w, 3)
    assert pc["colors"].shape == (h * w, 3)
    assert pc["is_foreground"].shape == (h * w,)
    assert pc["colors"].max() <= 1.0
    assert pc["colors"].min() >= 0.0


def test_depth_to_pointcloud_z_range():
    """Z values should be in [0.3, 5.0] range based on depth mapping."""
    depth_map = np.array([[0.0, 1.0]], dtype=np.float32)
    frame_rgb = np.zeros((1, 2, 3), dtype=np.uint8)
    fg_mask = np.ones((1, 2), dtype=np.float32)

    pc = depth_to_pointcloud(depth_map, frame_rgb, fg_mask)

    z_values = pc["positions"][:, 2]
    assert np.isclose(z_values[0], 0.3, atol=0.01), f"Min depth z should be ~0.3, got {z_values[0]}"
    assert np.isclose(z_values[1], 5.0, atol=0.01), f"Max depth z should be ~5.0, got {z_values[1]}"


def test_fg_mask_separation():
    """Foreground/background labels should match the input mask."""
    depth_map = np.random.rand(10, 10).astype(np.float32)
    frame_rgb = np.zeros((10, 10, 3), dtype=np.uint8)
    fg_mask = np.zeros((10, 10), dtype=np.float32)
    fg_mask[:5, :] = 1.0  # Top half is FG

    pc = depth_to_pointcloud(depth_map, frame_rgb, fg_mask)

    fg_count = pc["is_foreground"].sum()
    assert fg_count == 50, f"Expected 50 FG points, got {fg_count}"


def test_voxel_downsample_reduces_count():
    """Voxel downsampling should produce fewer points than input."""
    n = 10000
    positions = np.random.rand(n, 3).astype(np.float32)
    colors = np.random.rand(n, 3).astype(np.float32)
    is_fg = np.ones(n, dtype=bool)

    result = voxel_downsample(positions, colors, is_fg, voxel_size=0.1)

    assert len(result["positions"]) < n, "Downsampled count should be less than input"
    assert result["positions"].shape[1] == 3


def test_voxel_downsample_respects_max_count():
    """Downsampling should cap output at max_count."""
    n = 10000
    positions = np.random.rand(n, 3).astype(np.float32) * 10  # Spread out
    colors = np.random.rand(n, 3).astype(np.float32)
    is_fg = np.ones(n, dtype=bool)

    result = voxel_downsample(positions, colors, is_fg, voxel_size=0.001, max_count=500)

    assert len(result["positions"]) <= 500, f"Expected ≤500, got {len(result['positions'])}"


def test_pointcloud_to_splats_format():
    """Splats should have correct fields and shapes."""
    n = 100
    positions = np.random.rand(n, 3).astype(np.float32)
    colors = np.random.rand(n, 3).astype(np.float32)
    is_fg = np.ones(n, dtype=bool)

    splats = pointcloud_to_splats(positions, colors, is_fg)

    assert splats["positions"].shape == (n, 3)
    assert splats["colors"].shape == (n, 3)
    assert splats["sh0"].shape == (n, 3)
    assert splats["scales"].shape == (n, 3)
    assert splats["opacities"].shape == (n,)
    assert splats["rotations"].shape == (n, 4)


def test_splat_opacity_fg_bg():
    """FG splats should have opacity 1.0, BG splats 0.6."""
    positions = np.random.rand(10, 3).astype(np.float32)
    colors = np.random.rand(10, 3).astype(np.float32)
    is_fg = np.array([True] * 5 + [False] * 5)

    splats = pointcloud_to_splats(positions, colors, is_fg)

    assert np.all(splats["opacities"][:5] == 1.0)
    assert np.all(splats["opacities"][5:] == 0.6)


def test_splat_rotation_is_identity():
    """All rotations should be identity quaternion [1, 0, 0, 0]."""
    positions = np.random.rand(5, 3).astype(np.float32)
    colors = np.random.rand(5, 3).astype(np.float32)
    is_fg = np.ones(5, dtype=bool)

    splats = pointcloud_to_splats(positions, colors, is_fg)

    for i in range(5):
        assert np.allclose(splats["rotations"][i], [1, 0, 0, 0])


def test_delta_encoding_detects_changes():
    """Delta should only include splats that moved more than threshold."""
    n = 100
    base_pos = np.random.rand(n, 3).astype(np.float32)
    base_splats = pointcloud_to_splats(base_pos, np.random.rand(n, 3).astype(np.float32), np.ones(n, dtype=bool))

    # Modify 10 positions significantly
    mod_pos = base_pos.copy()
    mod_pos[:10] += 0.5  # Large change
    mod_splats = pointcloud_to_splats(mod_pos, base_splats["colors"], np.ones(n, dtype=bool))

    delta = compute_delta(mod_splats, base_splats, threshold=0.01)

    assert delta is not None
    assert len(delta["indices"]) == 10, f"Expected 10 changed, got {len(delta['indices'])}"


def test_delta_encoding_empty_when_static():
    """Delta should be empty when nothing changed."""
    n = 50
    pos = np.random.rand(n, 3).astype(np.float32)
    splats = pointcloud_to_splats(pos, np.random.rand(n, 3).astype(np.float32), np.ones(n, dtype=bool))

    delta = compute_delta(splats, splats, threshold=0.01)

    assert delta is not None
    assert len(delta["indices"]) == 0


def test_full_pipeline_keyframe():
    """First call to generate() should return a keyframe."""
    import cv2
    reset()

    h, w = 100, 100
    frame_bgr = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    depth_map = np.random.rand(h, w).astype(np.float32)
    fg_mask = np.ones((h, w), dtype=np.float32)

    result = generate(depth_map, frame_bgr, fg_mask)

    assert result["type"] == "keyframe"
    assert result["splat_count"] > 0
    assert "positions" in result["splats"]
    assert "colors" in result["splats"]


def test_full_pipeline_delta():
    """Second call to generate() with similar frame should return a delta."""
    import cv2
    reset()

    h, w = 100, 100
    frame_bgr = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    depth_map = np.random.rand(h, w).astype(np.float32)
    fg_mask = np.ones((h, w), dtype=np.float32)

    # First call → keyframe
    result1 = generate(depth_map, frame_bgr, fg_mask)
    assert result1["type"] == "keyframe"

    # Second call with same data → delta (should have few/no changes)
    result2 = generate(depth_map, frame_bgr, fg_mask)
    assert result2["type"] == "delta"


# ── Run all tests ──

if __name__ == "__main__":
    tests = [
        test_depth_to_pointcloud_shape,
        test_depth_to_pointcloud_z_range,
        test_fg_mask_separation,
        test_voxel_downsample_reduces_count,
        test_voxel_downsample_respects_max_count,
        test_pointcloud_to_splats_format,
        test_splat_opacity_fg_bg,
        test_splat_rotation_is_identity,
        test_delta_encoding_detects_changes,
        test_delta_encoding_empty_when_static,
        test_full_pipeline_keyframe,
        test_full_pipeline_delta,
    ]

    for test in tests:
        try:
            test()
            print(f"  ✅ {test.__name__}")
        except AssertionError as e:
            print(f"  ❌ {test.__name__}: {e}")
            raise

    print(f"\n✅ All {len(tests)} splat generator tests passed!")
