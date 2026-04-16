/**
 * Tests for the SignalingService class.
 *
 * These are unit tests that mock the socket.io client to verify
 * the SignalingService correctly manages connections, events,
 * and listener lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock socket.io-client
const mockSocket = {
  connected: false,
  id: 'test-socket-id',
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    mockSocket.connected = true;
    return mockSocket;
  }),
}));

// Import after mock is set up
const { signaling } = await import('../services/signaling');

describe('SignalingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
  });

  afterEach(() => {
    signaling.disconnect();
  });

  describe('connect', () => {
    it('should create a socket connection', () => {
      const socket = signaling.connect();
      expect(socket).toBeDefined();
      expect(signaling.connected).toBe(true);
    });

    it('should return existing socket if already connected', () => {
      const socket1 = signaling.connect();
      mockSocket.connected = true;
      const socket2 = signaling.connect();
      expect(socket1).toBe(socket2);
    });
  });

  describe('emit', () => {
    it('should emit events through the socket', () => {
      signaling.connect();
      signaling.emit('join-room', {
        meetingId: 'test-123',
        displayName: 'Test User',
        photoURL: '',
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('join-room', {
        meetingId: 'test-123',
        displayName: 'Test User',
        photoURL: '',
      });
    });

    it('should not emit if not connected', () => {
      signaling.emit('leave-room');
      // Should not throw, just silently fail
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('on / off', () => {
    it('should register event listeners', () => {
      const callback = vi.fn();
      signaling.connect();
      signaling.on('room-joined', callback);
      expect(mockSocket.on).toHaveBeenCalledWith('room-joined', callback);
    });

    it('should unregister event listeners', () => {
      const callback = vi.fn();
      signaling.connect();
      signaling.on('room-joined', callback);
      signaling.off('room-joined', callback);
      expect(mockSocket.off).toHaveBeenCalledWith('room-joined', callback);
    });

    it('should re-attach listeners on reconnect', () => {
      const callback = vi.fn();
      signaling.on('peer-joined', callback);

      // Connect — should attach the pre-registered listener
      signaling.connect();
      expect(mockSocket.on).toHaveBeenCalledWith('peer-joined', callback);
    });
  });

  describe('disconnect', () => {
    it('should disconnect the socket', () => {
      signaling.connect();
      signaling.disconnect();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('properties', () => {
    it('should return socket id when connected', () => {
      signaling.connect();
      expect(signaling.id).toBe('test-socket-id');
    });

    it('should return undefined id when not connected', () => {
      expect(signaling.id).toBeUndefined();
    });
  });
});
