# Parallax GPU Worker — Dockerfile
# For local dev: docker build --target dev -t parallax-gpu-worker .
# For production: docker build -t parallax-gpu-worker .

# ── Development (CPU) ──────────────────
FROM python:3.11-slim AS dev

WORKDIR /app

# Install system deps for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

EXPOSE 8000

ENV DEPTH_BACKEND=midas
ENV MIDAS_MODEL_TYPE=MiDaS_small

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ── Production (CUDA GPU) ─────────────
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04 AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY src/ ./src/

EXPOSE 8000

ENV DEPTH_BACKEND=midas
ENV MIDAS_MODEL_TYPE=DPT_Large

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
