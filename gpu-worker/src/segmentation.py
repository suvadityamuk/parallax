"""Selfie segmentation for foreground/background splitting.

Uses MediaPipe Selfie Segmentation (Apache 2.0).
Runs on CPU — ~5ms per frame.
"""

import numpy as np
import cv2

# MediaPipe is imported lazily to avoid hard dependency during testing
_segmenter = None


def _load_segmenter():
    """Load MediaPipe selfie segmentation model."""
    global _segmenter
    try:
        import mediapipe as mp
        _segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(
            model_selection=0  # 0 = general, 1 = landscape
        )
        print("[Segmentation] MediaPipe selfie segmentation loaded")
    except ImportError:
        print("[Segmentation] WARNING: mediapipe not installed, using fallback")
        _segmenter = "fallback"


def init():
    """Initialize the segmentation model."""
    if _segmenter is None:
        _load_segmenter()


def segment(frame_bgr: np.ndarray, threshold: float = 0.6) -> np.ndarray:
    """Segment foreground from background.

    Args:
        frame_bgr: Input frame in BGR, shape (H, W, 3), uint8.
        threshold: Confidence threshold for foreground classification.

    Returns:
        Binary mask, shape (H, W), float32. 1.0 = foreground, 0.0 = background.
    """
    if _segmenter is None:
        init()

    if _segmenter == "fallback":
        # Fallback: treat center 60% as foreground (rough approximation)
        h, w = frame_bgr.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)
        margin_x = int(w * 0.2)
        margin_y = int(h * 0.15)
        mask[margin_y:h - margin_y, margin_x:w - margin_x] = 1.0
        return mask

    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    results = _segmenter.process(frame_rgb)

    if results.segmentation_mask is None:
        return np.ones(frame_bgr.shape[:2], dtype=np.float32)

    mask = results.segmentation_mask  # (H, W), float32, [0, 1]
    binary_mask = (mask > threshold).astype(np.float32)

    return binary_mask
