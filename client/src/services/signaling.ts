import { io, type Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export type ViewMode = 'normal' | 'anaglyph' | '3d';

export interface PeerInfo {
  peerId: string;
  displayName: string;
  photoURL: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  displayName: string;
  message: string;
  timestamp: number;
}

export interface SignalingEvents {
  // Emitted
  'join-room': (data: {
    meetingId: string;
    displayName: string;
    photoURL: string;
  }) => void;
  'leave-room': () => void;
  offer: (data: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  answer: (data: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (data: {
    to: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  'set-mode': (data: { mode: ViewMode }) => void;
  'toggle-media': (data: {
    kind: 'audio' | 'video';
    enabled: boolean;
  }) => void;
  'raise-hand': (data: { raised: boolean }) => void;
  'toggle-screen-share': (data: { sharing: boolean }) => void;
  'chat-message': (data: { message: string }) => void;

  // Anaglyph pipeline
  'anaglyph-frame': (data: { frame: string; glassesType: string }) => void;
  'anaglyph-result': (data: { from: string; frame: string; processingMs: number }) => void;
  'anaglyph-error': (data: { message: string }) => void;

  // Splat pipeline
  'splat-frame': (data: { frame: string }) => void;
  'splat-result': (data: {
    from: string;
    type: 'keyframe' | 'delta';
    splats: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- typed at consumption site
    splatCount: number;
    fgRatio: number;
    changedCount?: number;
    processingMs: number;
  }) => void;
  'splat-fallback': (data: { from: string; reason: string; bgFlow: number }) => void;
  'splat-error': (data: { message: string }) => void;

  // Received
  'room-joined': (data: {
    peerId: string;
    existingPeers: PeerInfo[];
    iceServers: RTCIceServer[];
    gpuAvailable?: boolean;
  }) => void;
  'peer-joined': (data: PeerInfo) => void;
  'peer-left': (data: { peerId: string }) => void;
  'offer-received': (data: {
    from: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  'answer-received': (data: {
    from: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  'ice-candidate-received': (data: {
    from: string;
    candidate: RTCIceCandidateInit;
  }) => void;
  'peer-media-toggle': (data: {
    peerId: string;
    kind: 'audio' | 'video';
    enabled: boolean;
  }) => void;
  'peer-hand-raised': (data: {
    peerId: string;
    raised: boolean;
  }) => void;
  'peer-mode-change': (data: {
    peerId: string;
    mode: ViewMode;
  }) => void;
  'peer-screen-share': (data: {
    peerId: string;
    sharing: boolean;
  }) => void;
  'peer-chat-message': (data: ChatMessage) => void;
  'room-full': () => void;
  error: (data: { message: string }) => void;
}

class SignalingService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  connect(): Socket {
    if (this.socket?.connected) return this.socket;

    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    // Re-attach any previously registered listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((cb) => {
        this.socket?.on(event, cb);
      });
    });

    return this.socket;
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  emit<K extends keyof SignalingEvents>(
    event: K,
    ...args: Parameters<SignalingEvents[K]>
  ) {
    this.socket?.emit(event, ...args);
  }

  on<K extends keyof SignalingEvents>(
    event: K,
    callback: SignalingEvents[K]
  ) {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(callback as (...args: unknown[]) => void);
    this.socket?.on(event as string, callback as (...args: unknown[]) => void);
  }

  off<K extends keyof SignalingEvents>(
    event: K,
    callback: SignalingEvents[K]
  ) {
    this.listeners.get(event as string)?.delete(callback as (...args: unknown[]) => void);
    this.socket?.off(event as string, callback as (...args: unknown[]) => void);
  }

  get connected() {
    return this.socket?.connected ?? false;
  }

  get id() {
    return this.socket?.id;
  }
}

export const signaling = new SignalingService();
