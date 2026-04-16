"""Frame-to-frame optical flow for background motion detection.

Uses OpenCV Farneback dense optical flow to detect camera/room movement.
When motion exceeds thresholds, triggers BG rebuild or 2D fallback.
"""

import numpy as np
import cv2
from . import config

_prev_gray: np.ndarray | None = None


def reset():
    """Reset flow state (e.g., on mode change or keyframe)."""
    global _prev_gray
    _prev_gray = None


def compute_bg_flow(
    frame_bgr: np.ndarray,
    fg_mask: np.ndarray,
) -> float:
    """Compute mean optical flow magnitude in the background region.

    Args:
        frame_bgr: Current frame in BGR, shape (H, W, 3), uint8.
        fg_mask: Foreground mask, shape (H, W), float32. 1.0 = FG, 0.0 = BG.

    Returns:
        Mean optical flow magnitude in background pixels.
        Returns 0.0 on the first call (no previous frame to compare).
    """
    global _prev_gray

    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

    if _prev_gray is None:
        _prev_gray = gray
        return 0.0

    # Compute dense optical flow
    flow = cv2.calcOpticalFlowFarneback(
        _prev_gray,
        gray,
        None,
        pyr_scale=0.5,
        levels=3,
        winsize=15,
        iterations=3,
        poly_n=5,
        poly_sigma=1.2,
        flags=0,
    )

    _prev_gray = gray

    # Compute flow magnitude
    mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)

    # Mask to background only
    bg_mask = (fg_mask < 0.5)
    if bg_mask.sum() < 100:
        # Almost no background pixels — no meaningful flow
        return 0.0

    bg_flow_mean = float(mag[bg_mask].mean())
    return bg_flow_mean


def is_extreme_motion(bg_flow: float) -> bool:
    """Check if background flow indicates extreme camera motion."""
    return bg_flow > config.BG_FLOW_EXTREME
