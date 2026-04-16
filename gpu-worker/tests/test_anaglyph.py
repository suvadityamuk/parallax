"""Tests for the anaglyph compositing module."""

import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.anaglyph import (
    composite_anaglyph,
    depth_to_disparity,
    dibr_warp,
    DUBOIS_MATRICES,
)


def test_dubois_matrices_exist():
    """All 4 glasses types should have left and right matrices."""
    for name in ["red_cyan", "red_blue", "green_magenta", "amber_blue"]:
        assert name in DUBOIS_MATRICES
        assert "left" in DUBOIS_MATRICES[name]
        assert "right" in DUBOIS_MATRICES[name]
        assert DUBOIS_MATRICES[name]["left"].shape == (3, 3)
        assert DUBOIS_MATRICES[name]["right"].shape == (3, 3)


def test_depth_to_disparity_range():
    """Disparity should be bounded and close objects should have higher disparity."""
    depth = np.array([[0.0, 0.5, 1.0]], dtype=np.float32)
    disp = depth_to_disparity(depth)

    # Close (depth=0) should have higher disparity than far (depth=1)
    assert disp[0, 0] > disp[0, 2], "Close should have higher disparity than far"


def test_dibr_warp_shape():
    """DIBR warp should preserve frame dimensions."""
    frame = np.random.randint(0, 255, (360, 640, 3), dtype=np.uint8)
    disparity = np.zeros((360, 640), dtype=np.float32)
    warped = dibr_warp(frame, disparity, direction=1.0)
    assert warped.shape == frame.shape


def test_dibr_warp_zero_disparity():
    """With zero disparity, warped frame should be identical to input."""
    frame = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    disparity = np.zeros((100, 100), dtype=np.float32)
    warped = dibr_warp(frame, disparity, direction=1.0)
    np.testing.assert_array_equal(warped, frame)


def test_composite_anaglyph_output_shape():
    """Composite should produce same-shaped output."""
    frame = np.random.randint(0, 255, (360, 640, 3), dtype=np.uint8)
    depth = np.random.rand(360, 640).astype(np.float32)
    result = composite_anaglyph(frame, depth, "red_cyan")
    assert result.shape == frame.shape
    assert result.dtype == np.uint8


def test_composite_all_glasses_types():
    """All 4 glasses types should produce valid output."""
    frame = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    depth = np.random.rand(100, 100).astype(np.float32)

    for glasses in ["red_cyan", "red_blue", "green_magenta", "amber_blue"]:
        result = composite_anaglyph(frame, depth, glasses)
        assert result.shape == frame.shape
        assert result.dtype == np.uint8
        # Check values are in valid range
        assert result.min() >= 0
        assert result.max() <= 255


def test_composite_red_cyan_has_color_separation():
    """Red/cyan anaglyph of a gradient frame with depth should show color differences."""
    # Horizontal color gradient (not uniform — so DIBR warp produces different L/R views)
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    for x in range(100):
        frame[:, x, :] = [x * 2, 255 - x * 2, 128]  # BGR gradient
    # Gradient depth
    depth = np.linspace(0, 1, 100, dtype=np.float32)[np.newaxis, :].repeat(100, axis=0)

    result = composite_anaglyph(frame, depth, "red_cyan")

    # The anaglyph should NOT be identical to the original (depth creates parallax)
    assert not np.array_equal(result, frame)


def test_composite_invalid_glasses_defaults_to_red_cyan():
    """Invalid glasses type should fall back to red_cyan without error."""
    frame = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    depth = np.random.rand(100, 100).astype(np.float32)
    result = composite_anaglyph(frame, depth, "invalid_type")
    assert result.shape == frame.shape


if __name__ == "__main__":
    test_dubois_matrices_exist()
    test_depth_to_disparity_range()
    test_dibr_warp_shape()
    test_dibr_warp_zero_disparity()
    test_composite_anaglyph_output_shape()
    test_composite_all_glasses_types()
    test_composite_red_cyan_has_color_separation()
    test_composite_invalid_glasses_defaults_to_red_cyan()
    print("✅ All anaglyph tests passed!")
