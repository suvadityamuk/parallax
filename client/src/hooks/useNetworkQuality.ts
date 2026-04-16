import { useCallback, useEffect, useRef, useState } from 'react';

export interface NetworkQuality {
  bandwidth: number; // Kbps
  latency: number; // ms RTT
  canAnaglyph: boolean;
  can3D: boolean;
  label: 'excellent' | 'good' | 'fair' | 'poor';
}

const THRESHOLDS = {
  '3d': { bandwidth: 1500, latency: 500 },
  anaglyph: { bandwidth: 500, latency: 400 },
  normal: { bandwidth: 150, latency: Infinity },
  audio: { bandwidth: 30, latency: Infinity },
};

export function useNetworkQuality(pc: RTCPeerConnection | null) {
  const [quality, setQuality] = useState<NetworkQuality>({
    bandwidth: 0,
    latency: 0,
    canAnaglyph: false,
    can3D: false,
    label: 'poor',
  });
  const prevBytesRef = useRef(0);
  const prevTimestampRef = useRef(0);

  const measure = useCallback(async () => {
    if (!pc) return;

    try {
      const stats = await pc.getStats();
      let totalBytesReceived = 0;
      let rtt = 0;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          totalBytesReceived += report.bytesReceived || 0;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime
            ? report.currentRoundTripTime * 1000
            : 0;
        }
      });

      const now = Date.now();
      const elapsed = (now - prevTimestampRef.current) / 1000;

      if (prevTimestampRef.current > 0 && elapsed > 0) {
        const bytesDelta = totalBytesReceived - prevBytesRef.current;
        const bandwidth = (bytesDelta * 8) / elapsed / 1000; // Kbps

        const canAnaglyph =
          bandwidth >= THRESHOLDS.anaglyph.bandwidth &&
          rtt < THRESHOLDS.anaglyph.latency;
        const can3D =
          bandwidth >= THRESHOLDS['3d'].bandwidth &&
          rtt < THRESHOLDS['3d'].latency;

        let label: NetworkQuality['label'] = 'poor';
        if (can3D) label = 'excellent';
        else if (canAnaglyph) label = 'good';
        else if (bandwidth >= THRESHOLDS.normal.bandwidth) label = 'fair';

        setQuality({ bandwidth, latency: rtt, canAnaglyph, can3D, label });
      }

      prevBytesRef.current = totalBytesReceived;
      prevTimestampRef.current = now;
    } catch {
      // Stats not available yet
    }
  }, [pc]);

  useEffect(() => {
    const interval = setInterval(measure, 3000);
    return () => clearInterval(interval);
  }, [measure]);

  return quality;
}
