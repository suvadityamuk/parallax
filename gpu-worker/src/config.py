"""Configuration for the GPU worker."""

import os
from dotenv import load_dotenv

load_dotenv()

# Depth model backend: "midas" (CPU-friendly) or "flashdepth" (GPU production)
DEPTH_BACKEND = os.getenv("DEPTH_BACKEND", "midas")

# MiDaS model type: "MiDaS_small" (fast), "DPT_Hybrid", "DPT_Large" (best)
MIDAS_MODEL_TYPE = os.getenv("MIDAS_MODEL_TYPE", "MiDaS_small")

# Processing resolution (frames are resized to this before depth estimation)
PROCESS_WIDTH = int(os.getenv("PROCESS_WIDTH", "640"))
PROCESS_HEIGHT = int(os.getenv("PROCESS_HEIGHT", "360"))

# Stereo parameters
IPD_MM = float(os.getenv("IPD_MM", "65.0"))  # Inter-pupillary distance
FOCAL_LENGTH_PX = float(os.getenv("FOCAL_LENGTH_PX", "500.0"))  # Virtual camera focal length
MAX_DISPARITY_PX = int(os.getenv("MAX_DISPARITY_PX", "30"))  # Max pixel shift for depth

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Splat generation
SPLAT_VOXEL_SIZE = float(os.getenv("SPLAT_VOXEL_SIZE", "0.02"))  # Voxel grid side length (meters)
SPLAT_MAX_COUNT = int(os.getenv("SPLAT_MAX_COUNT", "40000"))  # Max Gaussians per frame
DELTA_THRESHOLD = float(os.getenv("DELTA_THRESHOLD", "0.005"))  # Position change threshold for delta
BG_FLOW_EXTREME = float(os.getenv("BG_FLOW_EXTREME", "50.0"))  # Optical flow → 2D fallback
KEYFRAME_INTERVAL_S = float(os.getenv("KEYFRAME_INTERVAL_S", "3.0"))  # Seconds between keyframes
