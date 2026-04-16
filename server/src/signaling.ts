import type { Server, Socket } from 'socket.io';
import { processFrame, generateSplats, resetSplats, checkGpuHealth } from './gpu-proxy.js';

interface PeerInfo {
  socketId: string;
  displayName: string;
  photoURL: string;
}

// meetingId → Map<socketId, PeerInfo>
const rooms = new Map<string, Map<string, PeerInfo>>();

// socketId → meetingId
const socketToRoom = new Map<string, string>();

// socketId → active mode
const socketMode = new Map<string, string>();


// ICE servers configuration
function getIceServers(): RTCIceServer[] {
  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USER;
  const turnPass = process.env.TURN_PASS;

  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (turnUrl && turnUser && turnPass) {
    servers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnPass,
    });
  }

  return servers;
}

export function handleSocket(io: Server, socket: Socket) {
  // ── Join room ──────────────────────────────
  socket.on('join-room', (data: {
    meetingId: string;
    displayName: string;
    photoURL: string;
  }) => {
    const { meetingId, displayName, photoURL } = data;

    // Check room capacity (max 2 for 1-on-1)
    const room = rooms.get(meetingId);
    if (room && room.size >= 2) {
      socket.emit('room-full');
      return;
    }

    // Create room if doesn't exist
    if (!rooms.has(meetingId)) {
      rooms.set(meetingId, new Map());
    }

    const currentRoom = rooms.get(meetingId)!;
    const peerInfo: PeerInfo = { socketId: socket.id, displayName, photoURL };

    // Get existing peers before adding self
    const existingPeers = Array.from(currentRoom.values()).map((p) => ({
      peerId: p.socketId,
      displayName: p.displayName,
      photoURL: p.photoURL,
    }));

    // Add self to room
    currentRoom.set(socket.id, peerInfo);
    socketToRoom.set(socket.id, meetingId);
    socket.join(meetingId);

    console.log(`[Room ${meetingId}] ${displayName} joined (${currentRoom.size}/2)`);

    // Send room info to joiner
    socket.emit('room-joined', {
      peerId: socket.id,
      existingPeers,
      iceServers: getIceServers(),
    });

    // Notify existing peers
    socket.to(meetingId).emit('peer-joined', {
      peerId: socket.id,
      displayName,
      photoURL,
    });
  });

  // ── WebRTC signaling ───────────────────────
  socket.on('offer', (data: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit('offer-received', {
      from: socket.id,
      sdp: data.sdp,
    });
  });

  socket.on('answer', (data: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit('answer-received', {
      from: socket.id,
      sdp: data.sdp,
    });
  });

  socket.on('ice-candidate', (data: { to: string; candidate: RTCIceCandidateInit }) => {
    io.to(data.to).emit('ice-candidate-received', {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  // ── Media controls ─────────────────────────
  socket.on('toggle-media', (data: { kind: 'audio' | 'video'; enabled: boolean }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (meetingId) {
      socket.to(meetingId).emit('peer-media-toggle', {
        peerId: socket.id,
        kind: data.kind,
        enabled: data.enabled,
      });
    }
  });

  socket.on('raise-hand', (data: { raised: boolean }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (meetingId) {
      socket.to(meetingId).emit('peer-hand-raised', {
        peerId: socket.id,
        raised: data.raised,
      });
    }
  });

  // ── Mode change ────────────────────────────
  socket.on('set-mode', async (data: { mode: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    socketMode.set(socket.id, data.mode);
    if (meetingId) {
      console.log(`[Room ${meetingId}] ${socket.id} switched to ${data.mode} mode`);
      // Notify peer about mode change
      socket.to(meetingId).emit('peer-mode-change', {
        peerId: socket.id,
        mode: data.mode,
      });
    }
    // Reset splat state when entering 3D mode
    if (data.mode === '3d') {
      try {
        await resetSplats();
      } catch (err) {
        console.warn('[Splat] Failed to reset GPU worker state:', err);
      }
    }
  });

  // ── Anaglyph frame processing ──────────────
  socket.on('anaglyph-frame', async (data: { frame: string; glassesType: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;

    try {
      const result = await processFrame(data.frame, data.glassesType);
      // Send composited frame to the peer (viewer)
      socket.to(meetingId).emit('anaglyph-result', {
        from: socket.id,
        frame: result.frame,
        processingMs: result.processing_ms,
      });
    } catch (err) {
      console.error(`[Anaglyph] Processing failed for ${socket.id}:`, err);
      socket.emit('anaglyph-error', {
        message: 'GPU worker unavailable — falling back to normal video',
      });
    }
  });

  // ── 3D Splat frame processing ───────────────
  socket.on('splat-frame', async (data: { frame: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;

    try {
      const result = await generateSplats(data.frame);

      if (result.type === 'fallback') {
        // Extreme motion detected — signal 2D fallback to viewer
        socket.to(meetingId).emit('splat-fallback', {
          from: socket.id,
          reason: result.reason,
          bgFlow: result.meta?.bg_flow ?? 0,
        });
        return;
      }

      // Send splat data (keyframe or delta) to the peer
      socket.to(meetingId).emit('splat-result', {
        from: socket.id,
        type: result.type,
        splats: result.splats,
        splatCount: result.splat_count,
        fgRatio: result.fg_ratio,
        changedCount: result.changed_count,
        processingMs: result.meta?.processing_ms ?? 0,
      });
    } catch (err) {
      console.error(`[Splat] Processing failed for ${socket.id}:`, err);
      socket.emit('splat-error', {
        message: 'GPU worker unavailable — falling back to normal video',
      });
    }
  });

  // ── Leave / Disconnect ─────────────────────
  function handleLeave() {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;

    const room = rooms.get(meetingId);
    if (room) {
      const peerInfo = room.get(socket.id);
      room.delete(socket.id);
      console.log(`[Room ${meetingId}] ${peerInfo?.displayName || socket.id} left (${room.size}/2)`);

      if (room.size === 0) {
        rooms.delete(meetingId);
        console.log(`[Room ${meetingId}] Room closed`);
      }
    }

    socketToRoom.delete(socket.id);
    socketMode.delete(socket.id);
    socket.to(meetingId).emit('peer-left', { peerId: socket.id });
    socket.leave(meetingId);
  }

  socket.on('leave-room', handleLeave);
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    handleLeave();
  });
}
