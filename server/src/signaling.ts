import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { processFrame, generateSplats, resetSplats, checkGpuHealth } from './gpu-proxy.js';

interface PeerInfo {
  socketId: string;
  displayName: string;
  photoURL: string;
}

// meetingId → Map<socketId, PeerInfo>
const rooms = new Map<string, Map<string, PeerInfo>>();
const socketToRoom = new Map<string, string>();
const socketMode = new Map<string, string>();

function getIceServers(): RTCIceServer[] {
  const { TURN_URL: url, TURN_USER: user, TURN_PASS: credential } = process.env;

  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (url && user && credential) {
    servers.push({ urls: url, username: user, credential });
  }

  return servers;
}

export function handleSocket(io: Server, socket: Socket) {
  /** Broadcast an event to the caller's room (excluding caller). */
  function broadcastToRoom<T extends Record<string, unknown>>(event: string, data: T) {
    const meetingId = socketToRoom.get(socket.id);
    if (meetingId) socket.to(meetingId).emit(event, { peerId: socket.id, ...data });
  }

  // ── Join room ──────────────────────────────
  socket.on('join-room', async (data: { meetingId: string; displayName: string; photoURL: string }) => {
    const { meetingId, displayName, photoURL } = data;

    const room = rooms.get(meetingId);
    if (room && room.size >= 2) { socket.emit('room-full'); return; }
    if (!rooms.has(meetingId)) rooms.set(meetingId, new Map());

    const currentRoom = rooms.get(meetingId)!;
    const existingPeers = Array.from(currentRoom.values()).map((p) => ({
      peerId: p.socketId, displayName: p.displayName, photoURL: p.photoURL,
    }));

    currentRoom.set(socket.id, { socketId: socket.id, displayName, photoURL });
    socketToRoom.set(socket.id, meetingId);
    socket.join(meetingId);
    console.log(`[Room ${meetingId}] ${displayName} joined (${currentRoom.size}/2)`);

    const gpuAvailable = await checkGpuHealth();
    socket.emit('room-joined', { peerId: socket.id, existingPeers, iceServers: getIceServers(), gpuAvailable });
    socket.to(meetingId).emit('peer-joined', { peerId: socket.id, displayName, photoURL });
  });

  // ── WebRTC signaling ───────────────────────
  socket.on('offer', (data: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit('offer-received', { from: socket.id, sdp: data.sdp });
  });

  socket.on('answer', (data: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit('answer-received', { from: socket.id, sdp: data.sdp });
  });

  socket.on('ice-candidate', (data: { to: string; candidate: RTCIceCandidateInit }) => {
    io.to(data.to).emit('ice-candidate-received', { from: socket.id, candidate: data.candidate });
  });

  // ── Simple relays (media, hand, screen share) ──
  socket.on('toggle-media', (data: { kind: 'audio' | 'video'; enabled: boolean }) => {
    broadcastToRoom('peer-media-toggle', { kind: data.kind, enabled: data.enabled });
  });

  socket.on('raise-hand', (data: { raised: boolean }) => {
    broadcastToRoom('peer-hand-raised', { raised: data.raised });
  });

  socket.on('toggle-screen-share', (data: { sharing: boolean }) => {
    broadcastToRoom('peer-screen-share', { sharing: data.sharing });
  });

  // ── Chat ────────────────────────────────────
  socket.on('chat-message', (data: { message: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;
    const peerInfo = rooms.get(meetingId)?.get(socket.id);
    socket.to(meetingId).emit('peer-chat-message', {
      id: uuidv4(), from: socket.id,
      displayName: peerInfo?.displayName || 'Unknown',
      message: data.message, timestamp: Date.now(),
    });
  });

  // ── Mode change ────────────────────────────
  socket.on('set-mode', async (data: { mode: string }) => {
    socketMode.set(socket.id, data.mode);
    broadcastToRoom('peer-mode-change', { mode: data.mode });

    const meetingId = socketToRoom.get(socket.id);
    if (meetingId) console.log(`[Room ${meetingId}] ${socket.id} → ${data.mode} mode`);

    if (data.mode === '3d') {
      try { await resetSplats(); } catch (err) { console.warn('[Splat] Failed to reset:', err); }
    }
  });

  // ── GPU processing ─────────────────────────
  socket.on('anaglyph-frame', async (data: { frame: string; glassesType: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;
    try {
      const result = await processFrame(data.frame, data.glassesType);
      socket.to(meetingId).emit('anaglyph-result', { from: socket.id, frame: result.frame, processingMs: result.processing_ms });
    } catch (err) {
      console.error(`[Anaglyph] Failed for ${socket.id}:`, err);
      socket.emit('anaglyph-error', { message: 'GPU worker unavailable — falling back to normal video' });
    }
  });

  socket.on('splat-frame', async (data: { frame: string }) => {
    const meetingId = socketToRoom.get(socket.id);
    if (!meetingId) return;
    try {
      const result = await generateSplats(data.frame);
      if (result.type === 'fallback') {
        socket.to(meetingId).emit('splat-fallback', { from: socket.id, reason: result.reason, bgFlow: result.meta?.bg_flow ?? 0 });
      } else {
        socket.to(meetingId).emit('splat-result', {
          from: socket.id, type: result.type, splats: result.splats,
          splatCount: result.splat_count, fgRatio: result.fg_ratio,
          changedCount: result.changed_count, processingMs: result.meta?.processing_ms ?? 0,
        });
      }
    } catch (err) {
      console.error(`[Splat] Failed for ${socket.id}:`, err);
      socket.emit('splat-error', { message: 'GPU worker unavailable — falling back to normal video' });
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
      if (room.size === 0) { rooms.delete(meetingId); console.log(`[Room ${meetingId}] Room closed`); }
    }
    socketToRoom.delete(socket.id);
    socketMode.delete(socket.id);
    socket.to(meetingId).emit('peer-left', { peerId: socket.id });
    socket.leave(meetingId);
  }

  socket.on('leave-room', handleLeave);
  socket.on('disconnect', () => { console.log(`[Socket] Disconnected: ${socket.id}`); handleLeave(); });
}
