"""Parallax GPU Worker — FastAPI application.

Endpoints:
- POST /process-frame   : Accept a JPEG frame + glasses type, return anaglyph JPEG
- POST /generate-splats  : Accept a JPEG frame, return 3D Gaussian Splat data
- GET  /health           : Readiness probe
"""

import base64
import io
import time

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image

from . import config
from . import depth
from . import anaglyph
from . import segmentation
from . import optical_flow
from . import splat_generator

app = FastAPI(
    title="Parallax GPU Worker",
    description="Depth estimation, anaglyph compositing, and 3DGS for Parallax video meetings",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class ProcessFrameRequest(BaseModel):
    """Request body for /process-frame."""
    frame: str = Field(..., description="Base64-encoded JPEG frame")
    glasses_type: str = Field(
        default="red_cyan",
        description="Anaglyph glasses type: red_cyan, red_blue, green_magenta, amber_blue",
    )


class ProcessFrameResponse(BaseModel):
    """Response body for /process-frame."""
    frame: str = Field(..., description="Base64-encoded anaglyph JPEG frame")
    processing_ms: float = Field(..., description="Processing time in milliseconds")
    depth_backend: str = Field(..., description="Depth estimation backend used")


@app.on_event("startup")
async def startup():
    """Pre-load models on startup to avoid cold start on first request."""
    print(f"[Worker] Starting with depth backend: {config.DEPTH_BACKEND}")
    print(f"[Worker] Processing resolution: {config.PROCESS_WIDTH}x{config.PROCESS_HEIGHT}")
    try:
        depth.init()
        print("[Worker] Depth model loaded successfully")
    except Exception as e:
        print(f"[Worker] WARNING: Failed to pre-load depth model: {e}")
        print("[Worker] Model will be loaded on first request")

    try:
        segmentation.init()
        print("[Worker] Segmentation model loaded successfully")
    except Exception as e:
        print(f"[Worker] WARNING: Failed to pre-load segmentation: {e}")
        print("[Worker] Segmentation will use fallback")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "depth_backend": config.DEPTH_BACKEND,
        "model_loaded": depth._model is not None,
    }


@app.post("/process-frame", response_model=ProcessFrameResponse)
async def process_frame(request: ProcessFrameRequest):
    """Process a video frame into an anaglyph 3D image.

    Pipeline:
    1. Decode base64 JPEG → BGR numpy array
    2. Resize to processing resolution
    3. Estimate depth (MiDaS or FlashDepth)
    4. Composite anaglyph (DIBR warp + Dubois matrices)
    5. Encode result as JPEG → base64
    """
    t0 = time.perf_counter()

    # 1. Decode frame
    try:
        frame_bytes = base64.b64decode(request.frame)
        frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame_bgr = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            raise ValueError("Failed to decode image")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid frame data: {e}")

    original_h, original_w = frame_bgr.shape[:2]

    # 2. Resize to processing resolution
    proc_frame = cv2.resize(
        frame_bgr,
        (config.PROCESS_WIDTH, config.PROCESS_HEIGHT),
        interpolation=cv2.INTER_LINEAR,
    )

    # 3. Estimate depth
    try:
        depth_map = depth.estimate(proc_frame)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Depth estimation failed: {e}")

    # 4. Composite anaglyph
    try:
        anaglyph_frame = anaglyph.composite_anaglyph(
            proc_frame, depth_map, request.glasses_type
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Anaglyph compositing failed: {e}")

    # 5. Resize back to original resolution and encode
    if (original_w, original_h) != (config.PROCESS_WIDTH, config.PROCESS_HEIGHT):
        anaglyph_frame = cv2.resize(
            anaglyph_frame,
            (original_w, original_h),
            interpolation=cv2.INTER_LINEAR,
        )

    _, jpeg_buf = cv2.imencode(".jpg", anaglyph_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    result_b64 = base64.b64encode(jpeg_buf.tobytes()).decode("ascii")

    processing_ms = (time.perf_counter() - t0) * 1000

    return ProcessFrameResponse(
        frame=result_b64,
        processing_ms=round(processing_ms, 1),
        depth_backend=config.DEPTH_BACKEND,
    )


# ── Splat generation endpoint ───────────────────────────────────────────


class GenerateSplatsRequest(BaseModel):
    """Request body for /generate-splats."""
    frame: str = Field(..., description="Base64-encoded JPEG frame")


@app.post("/generate-splats")
async def generate_splats(request: GenerateSplatsRequest):
    """Generate 3D Gaussian Splats from a video frame.

    Pipeline:
    1. Decode base64 JPEG → BGR numpy array
    2. Resize to processing resolution
    3. Segment foreground/background
    4. Estimate depth
    5. Compute background optical flow (motion detection)
    6. Generate splats (keyframe or delta)
    7. Return splat data as JSON
    """
    t0 = time.perf_counter()

    # 1. Decode frame
    try:
        frame_bytes = base64.b64decode(request.frame)
        frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame_bgr = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            raise ValueError("Failed to decode image")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid frame data: {e}")

    # 2. Resize
    proc_frame = cv2.resize(
        frame_bgr,
        (config.PROCESS_WIDTH, config.PROCESS_HEIGHT),
        interpolation=cv2.INTER_LINEAR,
    )

    # 3. Segment
    try:
        fg_mask = segmentation.segment(proc_frame)
    except Exception as e:
        # Fallback: treat everything as foreground
        fg_mask = np.ones(proc_frame.shape[:2], dtype=np.float32)
        print(f"[Worker] Segmentation fallback: {e}")

    # 4. Depth
    try:
        depth_map = depth.estimate(proc_frame)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Depth estimation failed: {e}")

    # 5. Optical flow for motion detection
    bg_flow = optical_flow.compute_bg_flow(proc_frame, fg_mask)
    fallback_2d = optical_flow.is_extreme_motion(bg_flow)

    if fallback_2d:
        processing_ms = (time.perf_counter() - t0) * 1000
        return {
            "type": "fallback",
            "fallback": "2d",
            "reason": "extreme_motion",
            "bg_flow": round(bg_flow, 2),
            "processing_ms": round(processing_ms, 1),
        }

    # 6. Generate splats
    try:
        result = splat_generator.generate(depth_map, proc_frame, fg_mask)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Splat generation failed: {e}")

    processing_ms = (time.perf_counter() - t0) * 1000

    return {
        **result,
        "meta": {
            "bg_flow": round(bg_flow, 2),
            "processing_ms": round(processing_ms, 1),
            "depth_backend": config.DEPTH_BACKEND,
        },
    }


@app.post("/reset-splats")
async def reset_splats():
    """Reset splat generator and optical flow state (e.g., on mode change)."""
    splat_generator.reset()
    optical_flow.reset()
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.HOST, port=config.PORT)
