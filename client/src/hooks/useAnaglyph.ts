/**
 * useAnaglyph — captures local video frames and sends them through
 * the GPU worker for anaglyph compositing when anaglyph mode is active.
 *
 * Flow:
 * 1. Captures frames from local video at ~15fps
 * 2. Encodes as JPEG base64
 * 3. Sends to server via Socket.io ('anaglyph-frame')
 * 4. Receives composited frames from server ('anaglyph-result')
 * 5. Renders composited frame onto a canvas overlay
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { signaling } from '../services/signaling';
import type { ViewMode } from '../services/signaling';

const CAPTURE_FPS = 12; // Lower than video FPS to reduce bandwidth
const JPEG_QUALITY = 0.6; // Balance quality vs. size

interface UseAnaglyphOptions {
  mode: ViewMode;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  glassesType: string;
}

export function useAnaglyph({ mode, localVideoRef, glassesType }: UseAnaglyphOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessingMs, setLastProcessingMs] = useState(0);
  const anaglyphFrameRef = useRef<string | null>(null);

  // Create offscreen canvas for frame capture
  const getOrCreateCaptureCanvas = useCallback(() => {
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    return captureCanvasRef.current;
  }, []);

  // Capture a frame from the local video and send to server
  const captureAndSend = useCallback(() => {
    const video = localVideoRef.current;
    if (!video || video.readyState < 2) return; // Not ready

    const canvas = getOrCreateCaptureCanvas();
    canvas.width = 640; // Process at reduced resolution
    canvas.height = 360;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, 640, 360);

    // Convert to base64 JPEG (strip the data URL prefix)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1];

    signaling.emit('anaglyph-frame', {
      frame: base64,
      glassesType,
    });
  }, [localVideoRef, glassesType, getOrCreateCaptureCanvas]);

  // Start/stop frame capture loop
  useEffect(() => {
    if (mode !== 'anaglyph') {
      // Clean up when leaving anaglyph mode
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsProcessing(false);
      anaglyphFrameRef.current = null;
      return;
    }

    setIsProcessing(true);
    intervalRef.current = setInterval(captureAndSend, 1000 / CAPTURE_FPS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mode, captureAndSend]);

  // Listen for anaglyph results from server
  useEffect(() => {
    const handleResult = (data: { from: string; frame: string; processingMs: number }) => {
      anaglyphFrameRef.current = data.frame;
      setLastProcessingMs(data.processingMs);
      renderAnaglyphFrame(data.frame);
    };

    const handleError = (data: { message: string }) => {
      console.warn('[Anaglyph] GPU worker error:', data.message);
      setIsProcessing(false);
    };

    signaling.on('anaglyph-result', handleResult);
    signaling.on('anaglyph-error', handleError);

    return () => {
      signaling.off('anaglyph-result', handleResult);
      signaling.off('anaglyph-error', handleError);
    };
  }, []);

  // Render the anaglyph frame onto the overlay canvas
  const renderAnaglyphFrame = useCallback((frameBase64: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${frameBase64}`;
  }, []);

  return {
    canvasRef,
    isProcessing,
    lastProcessingMs,
  };
}
