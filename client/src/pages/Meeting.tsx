import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useRef, useState, useCallback } from 'react';
import { signaling, type PeerInfo } from '../services/signaling';
import { useNetworkQuality } from '../hooks/useNetworkQuality';
import { useToast } from '../hooks/useToast';
import { useAnaglyph } from '../hooks/useAnaglyph';
import { useSplat } from '../hooks/useSplat';
import { SplatViewer } from '../components/SplatViewer';
import type { ViewMode } from '../services/signaling';
import './Meeting.css';

export function Meeting() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user, preferences } = useAuth();

  // Local media
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // State
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [remotePeer, setRemotePeer] = useState<PeerInfo | null>(null);
  const [remoteHandRaised, setRemoteHandRaised] = useState(false);
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  const [currentMode, setCurrentMode] = useState<ViewMode>(preferences.defaultMode);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);

  // Hooks
  const networkQuality = useNetworkQuality(pcRef.current);
  const { toasts, addToast, removeToast } = useToast();
  const { canvasRef: anaglyphCanvasRef, isProcessing: anaglyphProcessing, lastProcessingMs } =
    useAnaglyph({
      mode: currentMode,
      localVideoRef,
      glassesType: preferences.anaglyphType,
    });
  const {
    scene: splatScene,
    sceneVersion: splatVersion,
    isLoading: splatLoading,
    splatCount,
    lastProcessingMs: splatProcessingMs,
    fallbackReason: splatFallback,
  } = useSplat({ mode: currentMode, localVideoRef });

  // Auto-downgrade: if bandwidth drops below 500 Kbps for 5s while in anaglyph
  const lowBandwidthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (currentMode !== 'anaglyph') {
      if (lowBandwidthTimerRef.current) {
        clearTimeout(lowBandwidthTimerRef.current);
        lowBandwidthTimerRef.current = null;
      }
      return;
    }

    if (!networkQuality.canAnaglyph && !lowBandwidthTimerRef.current) {
      addToast('⚠️ Low bandwidth — switching to Normal in 5s', 'warning', 5000);
      lowBandwidthTimerRef.current = setTimeout(() => {
        setCurrentMode('normal');
        signaling.emit('set-mode', { mode: 'normal' });
        addToast('Switched to Normal mode due to low bandwidth', 'info', 3000);
        lowBandwidthTimerRef.current = null;
      }, 5000);
    } else if (networkQuality.canAnaglyph && lowBandwidthTimerRef.current) {
      clearTimeout(lowBandwidthTimerRef.current);
      lowBandwidthTimerRef.current = null;
    }
  }, [currentMode, networkQuality.canAnaglyph, addToast]);

  // Auto-downgrade for 3D mode: bandwidth < 1.5 Mbps or extreme motion fallback
  const lowBandwidth3dTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (currentMode !== '3d') {
      if (lowBandwidth3dTimerRef.current) {
        clearTimeout(lowBandwidth3dTimerRef.current);
        lowBandwidth3dTimerRef.current = null;
      }
      return;
    }

    if (!networkQuality.can3D && !lowBandwidth3dTimerRef.current) {
      addToast('⚠️ Low bandwidth — switching to Normal in 5s', 'warning', 5000);
      lowBandwidth3dTimerRef.current = setTimeout(() => {
        setCurrentMode('normal');
        signaling.emit('set-mode', { mode: 'normal' });
        addToast('Switched to Normal mode due to low bandwidth', 'info', 3000);
        lowBandwidth3dTimerRef.current = null;
      }, 5000);
    } else if (networkQuality.can3D && lowBandwidth3dTimerRef.current) {
      clearTimeout(lowBandwidth3dTimerRef.current);
      lowBandwidth3dTimerRef.current = null;
    }
  }, [currentMode, networkQuality.can3D, addToast]);

  // Handle splat fallback (extreme motion)
  useEffect(() => {
    if (splatFallback && currentMode === '3d') {
      addToast('🧊 3D paused — too much movement. Switching to Normal.', 'warning', 4000);
      setCurrentMode('normal');
      signaling.emit('set-mode', { mode: 'normal' });
    }
  }, [splatFallback, currentMode, addToast]);

  // Initialize local media
  const initMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Failed to get media:', err);
      addToast('Camera/mic access denied', 'warning');
    }
  }, [addToast]);

  // Create peer connection
  const createPeerConnection = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection({
        iceServers: iceServers.length
          ? iceServers
          : [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          signaling.emit('ice-candidate', {
            to: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        if (pc.connectionState === 'failed') {
          addToast('Connection lost. Attempting to reconnect...', 'warning');
        }
      };

      // Add local tracks
      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pcRef.current = pc;
      return pc;
    },
    [iceServers, addToast]
  );

  // Handle signaling
  useEffect(() => {
    if (!meetingId || !user) return;

    signaling.connect();

    signaling.on('room-joined', async (data) => {
      setIceServers(data.iceServers);

      if (data.existingPeers.length > 0) {
        // Join existing peer — create offer
        const peer = data.existingPeers[0];
        setRemotePeer(peer);
        const pc = createPeerConnection(peer.peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.emit('offer', { to: peer.peerId, sdp: offer });
      }
    });

    signaling.on('peer-joined', (data) => {
      setRemotePeer(data);
      addToast(`${data.displayName} joined`, 'info', 3000);
    });

    signaling.on('peer-left', (_data) => {
      setRemotePeer(null);
      setRemoteHandRaised(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      pcRef.current?.close();
      pcRef.current = null;
      addToast('Peer left the meeting', 'info', 3000);
    });

    signaling.on('offer-received', async (data) => {
      const pc = createPeerConnection(data.from);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signaling.emit('answer', { to: data.from, sdp: answer });
    });

    signaling.on('answer-received', async (data) => {
      await pcRef.current?.setRemoteDescription(data.sdp);
    });

    signaling.on('ice-candidate-received', async (data) => {
      try {
        await pcRef.current?.addIceCandidate(data.candidate);
      } catch (err) {
        console.error('Failed to add ICE candidate:', err);
      }
    });

    signaling.on('peer-media-toggle', (data) => {
      if (data.kind === 'audio') setRemoteAudioEnabled(data.enabled);
      if (data.kind === 'video') setRemoteVideoEnabled(data.enabled);
    });

    signaling.on('peer-hand-raised', (data) => {
      setRemoteHandRaised(data.raised);
      if (data.raised) {
        addToast('✋ Peer raised their hand', 'info', 4000);
      }
    });

    signaling.on('room-full', () => {
      addToast('Meeting is full (max 2 participants)', 'warning');
      setTimeout(() => navigate('/'), 3000);
    });

    // Join room after media is ready
    initMedia().then(() => {
      signaling.emit('join-room', {
        meetingId,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
      });
    });

    return () => {
      signaling.emit('leave-room');
      signaling.disconnect();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [meetingId, user, createPeerConnection, initMedia, addToast, navigate]);

  // Controls
  function toggleMute() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
      signaling.emit('toggle-media', {
        kind: 'audio',
        enabled: audioTrack.enabled,
      });
    }
  }

  function toggleCamera() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
      signaling.emit('toggle-media', {
        kind: 'video',
        enabled: videoTrack.enabled,
      });
    }
  }

  function toggleHand() {
    const newState = !handRaised;
    setHandRaised(newState);
    signaling.emit('raise-hand', { raised: newState });
  }

  function changeMode(mode: ViewMode) {
    if (mode === 'anaglyph' && !networkQuality.canAnaglyph) return;
    if (mode === '3d' && !networkQuality.can3D) return;
    setCurrentMode(mode);
    signaling.emit('set-mode', { mode });
  }

  function leaveMeeting() {
    navigate('/');
  }

  function copyMeetingLink() {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    addToast('Meeting link copied!', 'success', 2000);
  }

  const participantCount = remotePeer ? 2 : 1;

  return (
    <div className="meeting">
      {/* Toast container */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.type}`}
            onClick={() => removeToast(toast.id)}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Top bar */}
      <header className="meeting-header">
        <div className="meeting-header-left">
          <span className="meeting-id">{meetingId}</span>
          <button className="btn btn-secondary" onClick={copyMeetingLink} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
            📋 Copy link
          </button>
          <span className={`connection-dot connection-dot--${connectionState === 'connected' ? 'good' : 'poor'}`} />
        </div>

        {/* Mode toggle */}
        <div className="mode-bar">
          <button
            className={`mode-btn ${currentMode === 'normal' ? 'active' : ''}`}
            onClick={() => changeMode('normal')}
          >
            🎥 Normal
          </button>
          <button
            className={`mode-btn ${currentMode === 'anaglyph' ? 'active' : ''}`}
            onClick={() => changeMode('anaglyph')}
            disabled={!networkQuality.canAnaglyph}
            data-tooltip={`Requires 500 Kbps • Current: ${Math.round(networkQuality.bandwidth)} Kbps`}
          >
            👓 Anaglyph
          </button>
          <button
            className={`mode-btn ${currentMode === '3d' ? 'active' : ''}`}
            onClick={() => changeMode('3d')}
            disabled={!networkQuality.can3D}
            data-tooltip={`Requires 1.5 Mbps • Current: ${Math.round(networkQuality.bandwidth)} Kbps`}
          >
            🧊 3D
          </button>
        </div>

        <div className="meeting-header-right">
          <span className="network-badge" data-quality={networkQuality.label}>
            {networkQuality.label}
          </span>
        </div>
      </header>

      {/* Video area */}
      <main className="meeting-stage">
        <div className="video-grid" data-count={participantCount}>
          {/* Remote video (main) */}
          {remotePeer ? (
            <div className="video-tile">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`${!remoteVideoEnabled ? 'video-hidden' : ''} ${currentMode === 'anaglyph' ? 'video-behind-anaglyph' : ''} ${currentMode === '3d' ? 'video-behind-splat' : ''}`}
              />
              {/* Anaglyph canvas overlay */}
              {currentMode === 'anaglyph' && (
                <canvas
                  ref={anaglyphCanvasRef}
                  className="anaglyph-overlay"
                />
              )}
              {/* 3D Splat viewer overlay */}
              {currentMode === '3d' && (
                <SplatViewer
                  scene={splatScene}
                  sceneVersion={splatVersion}
                  isLoading={splatLoading}
                  splatCount={splatCount}
                  processingMs={splatProcessingMs}
                />
              )}
              {!remoteVideoEnabled && (
                <div className="video-placeholder">
                  <img src={remotePeer.photoURL} alt="" className="video-placeholder-avatar" />
                </div>
              )}
              <div className="user-label">
                {!remoteAudioEnabled && <span>🔇</span>}
                {remoteHandRaised && <span>✋</span>}
                <span>{remotePeer.displayName}</span>
                {currentMode === 'anaglyph' && anaglyphProcessing && (
                  <span className="anaglyph-badge" title={`Processing: ${lastProcessingMs}ms`}>👓 3D</span>
                )}
                {currentMode === '3d' && splatScene && (
                  <span className="anaglyph-badge" title={`${splatCount} splats • ${splatProcessingMs.toFixed(0)}ms`}>🧊 3D</span>
                )}
              </div>
            </div>
          ) : (
            <div className="video-tile video-tile--waiting">
              <div className="waiting-message">
                <div className="waiting-dots">
                  <span /><span /><span />
                </div>
                <p>Waiting for someone to join...</p>
                <button className="btn btn-secondary" onClick={copyMeetingLink}>
                  📋 Share meeting link
                </button>
              </div>
            </div>
          )}

          {/* Local video (when alone, full tile; when paired, PIP) */}
          {!remotePeer ? (
            <div className="video-tile">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="user-label">
                <span>{user?.displayName} (You)</span>
              </div>
            </div>
          ) : (
            <div className="self-view-floating">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
            </div>
          )}
        </div>
      </main>

      {/* Controls bar */}
      <footer className="controls-bar">
        <button
          className={`btn btn-icon btn-secondary ${isMuted ? 'active' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          className={`btn btn-icon btn-secondary ${isCameraOff ? 'active' : ''}`}
          onClick={toggleCamera}
          title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
        >
          {isCameraOff ? '📷' : '📹'}
        </button>
        <button
          className={`btn btn-icon btn-secondary ${handRaised ? 'active' : ''}`}
          onClick={toggleHand}
          title={handRaised ? 'Lower hand' : 'Raise hand'}
          style={handRaised ? { background: 'var(--accent-warning)' } : {}}
        >
          ✋
        </button>
        <button
          className="btn btn-danger btn-icon"
          onClick={leaveMeeting}
          title="Leave meeting"
          style={{ width: '56px', borderRadius: 'var(--radius-pill)' }}
        >
          📞
        </button>
      </footer>
    </div>
  );
}
