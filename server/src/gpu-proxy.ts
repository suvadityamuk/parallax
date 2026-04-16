/**
 * GPU Worker proxy — forwards video frames to the Python worker
 * for anaglyph compositing and 3D Gaussian Splat generation.
 */

const GPU_WORKER_URL = process.env.GPU_WORKER_URL || 'http://localhost:8000';

export interface ProcessFrameResult {
  frame: string; // base64 JPEG
  processing_ms: number;
  depth_backend: string;
}

export interface SplatResult {
  type: 'keyframe' | 'delta' | 'fallback';
  splats?: Record<string, unknown>;
  splat_count?: number;
  fg_ratio?: number;
  changed_count?: number;
  fallback?: string;
  reason?: string;
  meta?: {
    bg_flow: number;
    processing_ms: number;
    depth_backend: string;
  };
}

/**
 * Send a video frame to the GPU worker for anaglyph processing.
 */
export async function processFrame(
  frameBase64: string,
  glassesType: string = 'red_cyan'
): Promise<ProcessFrameResult> {
  const response = await fetch(`${GPU_WORKER_URL}/process-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: frameBase64,
      glasses_type: glassesType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`GPU worker error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<ProcessFrameResult>;
}

/**
 * Send a video frame to the GPU worker for 3D Gaussian Splat generation.
 */
export async function generateSplats(
  frameBase64: string
): Promise<SplatResult> {
  const response = await fetch(`${GPU_WORKER_URL}/generate-splats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame: frameBase64 }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`GPU worker error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<SplatResult>;
}

/**
 * Reset splat generator state on the GPU worker.
 */
export async function resetSplats(): Promise<void> {
  await fetch(`${GPU_WORKER_URL}/reset-splats`, { method: 'POST' });
}

/**
 * Check if the GPU worker is healthy.
 */
export async function checkGpuHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${GPU_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

