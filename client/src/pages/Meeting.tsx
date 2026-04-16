import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useRef, useState, useCallback } from 'react';
import { signaling, type PeerInfo, type ChatMessage } from '../services/signaling';
import { useNetworkQuality } from '../hooks/useNetworkQuality';
import { useToast } from '../hooks/useToast';
import { useAnaglyph } from '../hooks/useAnaglyph';
import { useSplat } from '../hooks/useSplat';
import { SplatViewer } from '../components/SplatViewer';
import { ChatPanel } from '../components/ChatPanel';
import type { ViewMode } from '../services/signaling';
import './Meeting.css';

// ── Helpers ────────────────────────────────────────

/** Returns a human-readable label for a ViewMode. */
function modeLabel(mode: ViewMode): string {
  return mode === '3d' ? '3D Splatting' : mode === 'anaglyph' ? 'Anaglyph 3D' : 'Normal';
}

/** Finds the video sender on a peer connection. */
function getVideoSender(pc: RTCPeerConnection | null) {
  return pc?.getSenders().find((s) => s.track?.kind === 'video');
}

// ── Component ──────────────────────────────────────

export function Meeting() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user, preferences } = useAuth();

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const chatOpenRef = useRef(false);
  const iceRestartAttemptRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lowBwTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAX_ICE_RESTARTS = 3;

  // State
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [remotePeer, setRemotePeer] = useState<PeerInfo | null>(null);
  const [remoteHandRaised, setRemoteHandRaised] = useState(false);
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  const [currentMode, setCurrentMode] = useState<ViewMode>(preferences.defaultMode);
  const [remoteMode, setRemoteMode] = useState<ViewMode>('normal');
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  // Hooks
  const networkQuality = useNetworkQuality(pcRef.current);
  const { toasts, addToast, removeToast } = useToast();
  const { canvasRef: anaglyphCanvasRef, isProcessing: anaglyphProcessing, lastProcessingMs } =
    useAnaglyph({ mode: currentMode, localVideoRef, glassesType: preferences.anaglyphType });
  const {
    scene: splatScene, sceneVersion: splatVersion, isLoading: splatLoading,
    splatCount, lastProcessingMs: splatProcessingMs, fallbackReason: splatFallback,
  } = useSplat({ mode: currentMode, localVideoRef });

  // Keep chatOpenRef in sync
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // Apply volume to remote video
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.volume = preferences.volumeLevel / 100;
    }
  }, [preferences.volumeLevel, remotePeer]);

  // ── Auto-downgrade on low bandwidth ──────────
  // Unified for both anaglyph and 3D — monitors the relevant threshold
  useEffect(() => {
    const isEnhanced = currentMode === 'anaglyph' || currentMode === '3d';
    const canSustain = currentMode === 'anaglyph' ? networkQuality.canAnaglyph : networkQuality.can3D;

    if (!isEnhanced) {
      if (lowBwTimerRef.current) { clearTimeout(lowBwTimerRef.current); lowBwTimerRef.current = null; }
      return;
    }

    if (!canSustain && !lowBwTimerRef.current) {
      addToast('⚠️ Low bandwidth — switching to Normal in 5s', 'warning', 5000);
      lowBwTimerRef.current = setTimeout(() => {
        setCurrentMode('normal');
        signaling.emit('set-mode', { mode: 'normal' });
        addToast('Switched to Normal mode due to low bandwidth', 'info', 3000);
        lowBwTimerRef.current = null;
      }, 5000);
    } else if (canSustain && lowBwTimerRef.current) {
      clearTimeout(lowBwTimerRef.current);
      lowBwTimerRef.current = null;
    }
  }, [currentMode, networkQuality.canAnaglyph, networkQuality.can3D, addToast]);

  // Handle splat fallback (extreme motion)
  useEffect(() => {
    if (splatFallback && currentMode === '3d') {
      addToast('🧊 3D paused — too much movement. Switching to Normal.', 'warning', 4000);
      setCurrentMode('normal');
      signaling.emit('set-mode', { mode: 'normal' });
    }
  }, [splatFallback, currentMode, addToast]);

  // ── Media & Peer Connection ──────────────────

  const initMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (err) {
      console.error('Failed to get media:', err);
      addToast('Camera/mic access denied', 'warning');
    }
  }, [addToast]);

  const attemptIceRestart = useCallback(async (pc: RTCPeerConnection, peerId: string) => {
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      signaling.emit('offer', { to: peerId, sdp: offer });
    } catch (err) {
      console.error('ICE restart failed:', err);
    }
  }, []);

  const createPeerConnection = useCallback((peerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: iceServers.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) signaling.emit('ice-candidate', { to: peerId, candidate: e.candidate.toJSON() });
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
        remoteVideoRef.current.volume = preferences.volumeLevel / 100;
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'failed') {
        if (iceRestartAttemptRef.current < MAX_ICE_RESTARTS) {
          iceRestartAttemptRef.current++;
          addToast(`Connection lost. Reconnecting (${iceRestartAttemptRef.current}/${MAX_ICE_RESTARTS})...`, 'warning', 4000);
          attemptIceRestart(pc, peerId);
        } else {
          addToast('Connection lost. Could not reconnect.', 'warning');
        }
      } else if (pc.connectionState === 'connected') {
        iceRestartAttemptRef.current = 0;
      }
    };

    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    pcRef.current = pc;
    return pc;
  }, [iceServers, addToast, preferences.volumeLevel, attemptIceRestart]);

  // ── Signaling ────────────────────────────────

  useEffect(() => {
    if (!meetingId || !user) return;
    signaling.connect();

    signaling.on('room-joined', async (data) => {
      setIceServers(data.iceServers);
      setGpuAvailable(data.gpuAvailable ?? false);
      if (data.existingPeers.length > 0) {
        const peer = data.existingPeers[0];
        setRemotePeer(peer);
        const pc = createPeerConnection(peer.peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.emit('offer', { to: peer.peerId, sdp: offer });
      }
    });

    signaling.on('peer-joined', (data) => { setRemotePeer(data); addToast(`${data.displayName} joined`, 'info', 3000); });

    signaling.on('peer-left', () => {
      setRemotePeer(null);
      setRemoteHandRaised(false);
      setRemoteScreenSharing(false);
      setRemoteMode('normal');
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
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

    signaling.on('answer-received', async (data) => { await pcRef.current?.setRemoteDescription(data.sdp); });

    signaling.on('ice-candidate-received', async (data) => {
      try { await pcRef.current?.addIceCandidate(data.candidate); } catch (err) { console.error('Failed to add ICE candidate:', err); }
    });

    signaling.on('peer-media-toggle', (data) => {
      if (data.kind === 'audio') setRemoteAudioEnabled(data.enabled);
      if (data.kind === 'video') setRemoteVideoEnabled(data.enabled);
    });

    signaling.on('peer-hand-raised', (data) => {
      setRemoteHandRaised(data.raised);
      if (data.raised) addToast('✋ Peer raised their hand', 'info', 4000);
    });

    signaling.on('peer-mode-change', (data) => { setRemoteMode(data.mode); addToast(`Peer switched to ${modeLabel(data.mode)}`, 'info', 3000); });
    signaling.on('peer-screen-share', (data) => { setRemoteScreenSharing(data.sharing); addToast(data.sharing ? '🖥️ Peer started screen sharing' : 'Peer stopped screen sharing', 'info', 3000); });

    signaling.on('peer-chat-message', (msg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (!chatOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
        addToast(`💬 ${msg.displayName}: ${msg.message.slice(0, 50)}`, 'info', 3000);
      }
    });

    signaling.on('room-full', () => { addToast('Meeting is full (max 2 participants)', 'warning'); setTimeout(() => navigate('/'), 3000); });

    initMedia().then(() => {
      signaling.emit('join-room', { meetingId, displayName: user.displayName || 'Anonymous', photoURL: user.photoURL || '' });
    });

    return () => {
      signaling.emit('leave-room');
      signaling.disconnect();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [meetingId, user, createPeerConnection, initMedia, addToast, navigate]);

  // ── Control handlers ─────────────────────────

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMuted(!track.enabled);
    signaling.emit('toggle-media', { kind: 'audio', enabled: track.enabled });
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsCameraOff(!track.enabled);
    signaling.emit('toggle-media', { kind: 'video', enabled: track.enabled });
  }

  function toggleHand() {
    setHandRaised((prev) => { signaling.emit('raise-hand', { raised: !prev }); return !prev; });
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack) await getVideoSender(pcRef.current)?.replaceTrack(cameraTrack);
      setIsScreenSharing(false);
      signaling.emit('toggle-screen-share', { sharing: false });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080 }, audio: false });
        screenStreamRef.current = stream;
        const screenTrack = stream.getVideoTracks()[0];
        await getVideoSender(pcRef.current)?.replaceTrack(screenTrack);
        screenTrack.onended = () => toggleScreenShare();
        setIsScreenSharing(true);
        signaling.emit('toggle-screen-share', { sharing: true });
      } catch {
        addToast('Screen sharing cancelled', 'info', 2000);
      }
    }
  }

  function sendChatMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    signaling.emit('chat-message', { message: trimmed });
    setChatMessages((prev) => [...prev, {
      id: crypto.randomUUID(), from: 'self',
      displayName: user?.displayName || 'You', message: trimmed, timestamp: Date.now(),
    }]);
  }

  function toggleChat() {
    setChatOpen((prev) => { if (!prev) setUnreadCount(0); return !prev; });
  }

  function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    // Capture remote video + local audio into one stream
    const remoteStream = remoteVideoRef.current?.srcObject as MediaStream | null;
    const localAudio = localStreamRef.current?.getAudioTracks()[0];
    if (!remoteStream) { addToast('No remote stream to record', 'warning', 2000); return; }

    const tracks = [...remoteStream.getTracks()];
    if (localAudio) tracks.push(localAudio);
    const combined = new MediaStream(tracks);

    const recorder = new MediaRecorder(combined, { mimeType: 'video/webm;codecs=vp9,opus' });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parallax-${meetingId}-${new Date().toISOString().slice(0, 16)}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Recording saved!', 'success', 3000);
    };

    recorder.start(1000); // Chunk every second
    recorderRef.current = recorder;
    setIsRecording(true);
    addToast('🔴 Recording started', 'info', 2000);
  }

  function changeMode(mode: ViewMode) {
    if (mode === 'anaglyph' && !networkQuality.canAnaglyph) return;
    if (mode === '3d' && !networkQuality.can3D) return;
    setCurrentMode(mode);
    signaling.emit('set-mode', { mode });
  }

  function copyMeetingLink() {
    navigator.clipboard.writeText(window.location.href);
    addToast('Meeting link copied!', 'success', 2000);
  }

  // ── Remote video class list ──────────────────
  const remoteVideoClass = [
    !remoteVideoEnabled && 'video-hidden',
    currentMode === 'anaglyph' && 'video-behind-anaglyph',
    currentMode === '3d' && 'video-behind-splat',
  ].filter(Boolean).join(' ');

  // ── Render ───────────────────────────────────

  return (
    <div className="meeting">
      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => removeToast(t.id)}>{t.message}</div>
        ))}
      </div>

      {/* Header */}
      <header className="meeting-header">
        <div className="meeting-header-left">
          <span className="meeting-id">{meetingId}</span>
          <button className="btn btn-secondary btn-xs" onClick={copyMeetingLink}>📋 Copy link</button>
          <span className={`connection-dot connection-dot--${connectionState === 'connected' ? 'good' : 'poor'}`} />
          {gpuAvailable && <span className="gpu-badge" title="GPU worker connected">⚡ GPU</span>}
        </div>

        <div className="mode-bar">
          {(['normal', 'anaglyph', '3d'] as const).map((mode) => (
            <button
              key={mode}
              className={`mode-btn ${currentMode === mode ? 'active' : ''}`}
              onClick={() => changeMode(mode)}
              disabled={mode === 'anaglyph' ? !networkQuality.canAnaglyph : mode === '3d' ? !networkQuality.can3D : false}
            >
              {mode === 'normal' ? '🎥 Normal' : mode === 'anaglyph' ? '👓 Anaglyph' : '🧊 3D'}
            </button>
          ))}
        </div>

        <div className="meeting-header-right">
          <span className="network-badge" data-quality={networkQuality.label}>{networkQuality.label}</span>
        </div>
      </header>

      {/* Stage */}
      <main className="meeting-stage">
        <div className="video-grid" data-count={remotePeer ? 2 : 1}>
          {remotePeer ? (
            <div className="video-tile">
              <video ref={remoteVideoRef} autoPlay playsInline className={remoteVideoClass} />
              {currentMode === 'anaglyph' && <canvas ref={anaglyphCanvasRef} className="anaglyph-overlay" />}
              {currentMode === '3d' && (
                <SplatViewer scene={splatScene} sceneVersion={splatVersion} isLoading={splatLoading} splatCount={splatCount} processingMs={splatProcessingMs} />
              )}
              {!remoteVideoEnabled && (
                <div className="video-placeholder">
                  <img src={remotePeer.photoURL} alt="" className="video-placeholder-avatar" />
                </div>
              )}
              <div className="user-label">
                {!remoteAudioEnabled && <span>🔇</span>}
                {remoteHandRaised && <span>✋</span>}
                {remoteScreenSharing && <span>🖥️</span>}
                <span>{remotePeer.displayName}</span>
                {remoteMode !== 'normal' && <span className="remote-mode-badge">{remoteMode === 'anaglyph' ? '👓' : '🧊'}</span>}
                {currentMode === 'anaglyph' && anaglyphProcessing && <span className="anaglyph-badge" title={`${lastProcessingMs}ms`}>👓 3D</span>}
                {currentMode === '3d' && splatScene && <span className="anaglyph-badge" title={`${splatCount} splats • ${splatProcessingMs.toFixed(0)}ms`}>🧊 3D</span>}
              </div>
            </div>
          ) : (
            <div className="video-tile video-tile--waiting">
              <div className="waiting-message">
                <div className="waiting-dots"><span /><span /><span /></div>
                <p>Waiting for someone to join...</p>
                <button className="btn btn-secondary" onClick={copyMeetingLink}>📋 Share meeting link</button>
              </div>
            </div>
          )}

          {!remotePeer ? (
            <div className="video-tile">
              <video ref={localVideoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)' }} />
              <div className="user-label"><span>{user?.displayName} (You)</span></div>
            </div>
          ) : (
            <div className="self-view-floating">
              <video ref={localVideoRef} autoPlay playsInline muted />
              {isScreenSharing && <div className="screen-share-indicator">🖥️ Sharing</div>}
            </div>
          )}
        </div>

        <ChatPanel isOpen={chatOpen} messages={chatMessages} onSend={sendChatMessage} onClose={toggleChat} />
      </main>

      {/* Controls */}
      <footer className="controls-bar">
        <button className={`btn btn-icon btn-secondary ${isMuted ? 'active' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button className={`btn btn-icon btn-secondary ${isCameraOff ? 'active' : ''}`} onClick={toggleCamera} title={isCameraOff ? 'Camera on' : 'Camera off'}>
          {isCameraOff ? '📷' : '📹'}
        </button>
        <button className={`btn btn-icon btn-secondary ${isScreenSharing ? 'btn-active-info' : ''}`} onClick={toggleScreenShare} title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
          🖥️
        </button>
        <button className={`btn btn-icon btn-secondary ${handRaised ? 'btn-active-warning' : ''}`} onClick={toggleHand} title={handRaised ? 'Lower hand' : 'Raise hand'}>
          ✋
        </button>
        <button className={`btn btn-icon btn-secondary ${chatOpen ? 'active' : ''} btn-relative`} onClick={toggleChat} title="Chat">
          💬
          {unreadCount > 0 && <span className="chat-unread-badge">{unreadCount}</span>}
        </button>
        <button className={`btn btn-icon btn-secondary ${isRecording ? 'btn-active-danger' : ''}`} onClick={toggleRecording} title={isRecording ? 'Stop recording' : 'Record'}>
          {isRecording ? '⏹️' : '⏺️'}
        </button>
        <button className="btn btn-danger btn-icon btn-leave" onClick={() => navigate('/')} title="Leave meeting">
          📞
        </button>
      </footer>
    </div>
  );
}
