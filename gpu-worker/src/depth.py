"""Depth estimation module.

Supports two backends:
- 'midas': CPU-friendly MiDaS via PyTorch Hub (good for local dev)
- 'flashdepth': GPU-accelerated FlashDepth (production, requires CUDA)
"""

import numpy as np
import cv2
import torch
from . import config

_model = None
_transform = None
_device = None


def _get_device() -> torch.device:
    """Select best available device."""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _load_midas():
    """Load MiDaS model from PyTorch Hub."""
    global _model, _transform, _device
    _device = _get_device()

    model_type = config.MIDAS_MODEL_TYPE
    _model = torch.hub.load("intel-isl/MiDaS", model_type, trust_repo=True)
    _model.to(_device)
    _model.eval()

    midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
    if model_type in ("DPT_Large", "DPT_Hybrid"):
        _transform = midas_transforms.dpt_transform
    else:
        _transform = midas_transforms.small_transform

    print(f"[Depth] Loaded MiDaS ({model_type}) on {_device}")


def init():
    """Initialize the depth estimation model."""
    if config.DEPTH_BACKEND == "midas":
        _load_midas()
    elif config.DEPTH_BACKEND == "flashdepth":
        # FlashDepth integration placeholder — requires separate install
        raise NotImplementedError(
            "FlashDepth backend not yet integrated. Use DEPTH_BACKEND=midas for now."
        )
    else:
        raise ValueError(f"Unknown depth backend: {config.DEPTH_BACKEND}")


def estimate(frame_bgr: np.ndarray) -> np.ndarray:
    """Estimate depth from a BGR frame.

    Args:
        frame_bgr: Input frame in BGR format, shape (H, W, 3), uint8.

    Returns:
        Normalized depth map, shape (H, W), float32 in [0, 1].
        0 = closest, 1 = farthest.
    """
    if _model is None:
        init()

    h, w = frame_bgr.shape[:2]
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    # MiDaS transform and inference
    input_batch = _transform(frame_rgb).to(_device)

    with torch.no_grad():
        prediction = _model(input_batch)
        # Resize to original frame dimensions
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=(h, w),
            mode="bicubic",
            align_corners=False,
        ).squeeze()

    depth = prediction.cpu().numpy()

    # MiDaS outputs inverse depth (close = high values)
    # Normalize to [0, 1] where 0=close, 1=far
    depth_min = depth.min()
    depth_max = depth.max()
    if depth_max - depth_min > 1e-6:
        depth = (depth - depth_min) / (depth_max - depth_min)
        depth = 1.0 - depth  # Invert: MiDaS high = close, we want 0 = close
    else:
        depth = np.zeros_like(depth)

    return depth.astype(np.float32)
