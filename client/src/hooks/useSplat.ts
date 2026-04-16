/**
 * useSplat — captures local video frames and sends them through
 * the GPU worker for 3D Gaussian Splat generation when 3D mode is active.
 *
 * Flow:
 * 1. Captures frames from local video at ~10fps
 * 2. Encodes as JPEG base64
 * 3. Sends to server via Socket.io ('splat-frame')
 * 4. Receives splat data from server ('splat-result')
 * 5. Manages splat scene state (keyframes replace, deltas merge)
 * 6. Signals the SplatViewer to re-render
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { signaling } from '../services/signaling';
import type { ViewMode } from '../services/signaling';

const CAPTURE_FPS = 10; // Lower than anaglyph — splat processing is heavier
const JPEG_QUALITY = 0.6;

/** Single Gaussian Splat in the scene */
export interface SplatData {
  positions: number[][]; // [[x,y,z], ...]
  colors: number[][];    // [[r,g,b], ...]
  scales: number[][];    // [[sx,sy,sz], ...]
  opacities: number[];   // [o1, o2, ...]
  rotations?: number[][]; // [[w,x,y,z], ...] — only in keyframes
}

/** Delta update — only changed splats */
export interface SplatDelta {
  indices: number[];
  positions: number[][];
  colors: number[][];
  scales: number[][];
  opacities: number[];
}

interface UseSplatOptions {
  mode: ViewMode;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useSplat({ mode, localVideoRef }: UseSplatOptions) {
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scene state
  const [scene, setScene] = useState<SplatData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [splatCount, setSplatCount] = useState(0);
  const [lastProcessingMs, setLastProcessingMs] = useState(0);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  // Track scene version for re-render triggers
  const sceneVersionRef = useRef(0);
  const [sceneVersion, setSceneVersion] = useState(0);

  const getOrCreateCaptureCanvas = useCallback(() => {
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    return captureCanvasRef.current;
  }, []);

  // Capture and send a frame
  const captureAndSend = useCallback(() => {
    const video = localVideoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = getOrCreateCaptureCanvas();
    canvas.width = 640;
    canvas.height = 360;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, 640, 360);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1];

    signaling.emit('splat-frame' as any, { frame: base64 });
  }, [localVideoRef, getOrCreateCaptureCanvas]);

  // Start/stop capture loop
  useEffect(() => {
    if (mode !== '3d') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsActive(false);
      setIsLoading(false);
      setScene(null);
      setFallbackReason(null);
      return;
    }

    setIsLoading(true);
    setIsActive(true);
    setFallbackReason(null);
    intervalRef.current = setInterval(captureAndSend, 1000 / CAPTURE_FPS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mode, captureAndSend]);

  // Listen for splat results
  useEffect(() => {
    const handleResult = (data: {
      from: string;
      type: 'keyframe' | 'delta';
      splats: SplatData | SplatDelta;
      splatCount: number;
      fgRatio: number;
      changedCount?: number;
      processingMs: number;
    }) => {
      setIsLoading(false);
      setSplatCount(data.splatCount);
      setLastProcessingMs(data.processingMs);

      if (data.type === 'keyframe') {
        // Replace entire scene
        setScene(data.splats as SplatData);
      } else {
        // Merge delta into existing scene
        setScene((prev) => {
          if (!prev) return data.splats as SplatData; // No previous scene — treat as keyframe

          const delta = data.splats as SplatDelta;
          const newPositions = [...prev.positions];
          const newColors = [...prev.colors];
          const newScales = [...prev.scales];
          const newOpacities = [...prev.opacities];

          for (let i = 0; i < delta.indices.length; i++) {
            const idx = delta.indices[i];
            if (idx < newPositions.length) {
              newPositions[idx] = delta.positions[i];
              newColors[idx] = delta.colors[i];
              newScales[idx] = delta.scales[i];
              newOpacities[idx] = delta.opacities[i];
            }
          }

          return {
            ...prev,
            positions: newPositions,
            colors: newColors,
            scales: newScales,
            opacities: newOpacities,
          };
        });
      }

      // Trigger re-render
      sceneVersionRef.current += 1;
      setSceneVersion(sceneVersionRef.current);
    };

    const handleFallback = (data: { from: string; reason: string; bgFlow: number }) => {
      console.warn('[Splat] Fallback triggered:', data.reason, 'bgFlow:', data.bgFlow);
      setFallbackReason(data.reason);
    };

    const handleError = (data: { message: string }) => {
      console.warn('[Splat] GPU worker error:', data.message);
      setIsActive(false);
      setIsLoading(false);
    };

    signaling.on('splat-result' as any, handleResult as any);
    signaling.on('splat-fallback' as any, handleFallback as any);
    signaling.on('splat-error' as any, handleError as any);

    return () => {
      signaling.off('splat-result' as any, handleResult as any);
      signaling.off('splat-fallback' as any, handleFallback as any);
      signaling.off('splat-error' as any, handleError as any);
    };
  }, []);

  return {
    scene,
    sceneVersion,
    isLoading,
    isActive,
    splatCount,
    lastProcessingMs,
    fallbackReason,
  };
}
