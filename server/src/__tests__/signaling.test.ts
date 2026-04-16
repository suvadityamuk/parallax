/**
 * Tests for server-side signaling logic (room management).
 *
 * Uses a real Socket.IO server + client to test the signaling
 * handlers end-to-end without the GPU worker (mocked).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { handleSocket } from '../signaling.js';

// Mock gpu-proxy to avoid real GPU worker calls
vi.mock('../gpu-proxy.js', () => ({
  processFrame: vi.fn().mockResolvedValue({
    frame: 'base64mock',
    processing_ms: 10,
    depth_backend: 'midas',
  }),
  generateSplats: vi.fn().mockResolvedValue({
    type: 'keyframe',
    splats: {},
    splat_count: 100,
    fg_ratio: 0.6,
  }),
  resetSplats: vi.fn().mockResolvedValue(undefined),
  checkGpuHealth: vi.fn().mockResolvedValue(true),
}));

let httpServer: HttpServer;
let ioServer: Server;
let port: number;

function createClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const client = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      autoConnect: true,
    });
    client.on('connect', () => resolve(client));
  });
}

beforeAll(async () => {
  httpServer = createServer();
  ioServer = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
  });

  ioServer.on('connection', (socket) => {
    handleSocket(ioServer, socket);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(() => {
  ioServer.close();
  httpServer.close();
});

describe('Signaling Server', () => {
  describe('join-room', () => {
    it('should emit room-joined with empty peers for first joiner', async () => {
      const client1 = await createClient();

      const data = await new Promise<any>((resolve) => {
        client1.on('room-joined', (d) => resolve(d));
        client1.emit('join-room', {
          meetingId: 'test-room-1',
          displayName: 'User 1',
          photoURL: 'https://example.com/photo1.jpg',
        });
      });

      expect(data).toHaveProperty('peerId');
      expect(data.existingPeers).toEqual([]);
      expect(data.iceServers).toBeDefined();
      expect(Array.isArray(data.iceServers)).toBe(true);
      expect(data.gpuAvailable).toBe(true);

      client1.disconnect();
    });

    it('should notify existing peer when second user joins', async () => {
      const c1 = await createClient();
      const c2 = await createClient();

      await new Promise<void>((resolve) => {
        c1.on('room-joined', () => resolve());
        c1.emit('join-room', {
          meetingId: 'test-room-2',
          displayName: 'User 1',
          photoURL: '',
        });
      });

      const peerData = await new Promise<any>((resolve) => {
        c1.on('peer-joined', (data) => resolve(data));
        c2.emit('join-room', {
          meetingId: 'test-room-2',
          displayName: 'User 2',
          photoURL: '',
        });
      });

      expect(peerData.displayName).toBe('User 2');

      c1.disconnect();
      c2.disconnect();
    });

    it('should reject third user with room-full', async () => {
      const c1 = await createClient();
      const c2 = await createClient();
      const c3 = await createClient();

      // First two join
      await new Promise<void>((resolve) => {
        c1.on('room-joined', () => resolve());
        c1.emit('join-room', { meetingId: 'full-room', displayName: 'A', photoURL: '' });
      });

      await new Promise<void>((resolve) => {
        c2.on('room-joined', () => resolve());
        c2.emit('join-room', { meetingId: 'full-room', displayName: 'B', photoURL: '' });
      });

      // Third should get room-full
      await new Promise<void>((resolve) => {
        c3.on('room-full', () => resolve());
        c3.emit('join-room', { meetingId: 'full-room', displayName: 'C', photoURL: '' });
      });

      c1.disconnect();
      c2.disconnect();
      c3.disconnect();
    });
  });

  describe('media controls', () => {
    it('should relay toggle-media to peers', async () => {
      const c1 = await createClient();
      const c2 = await createClient();

      // Join room
      await new Promise<void>((resolve) => {
        c1.on('room-joined', () => resolve());
        c1.emit('join-room', { meetingId: 'media-room', displayName: 'A', photoURL: '' });
      });

      await new Promise<void>((resolve) => {
        c2.on('room-joined', () => resolve());
        c2.emit('join-room', { meetingId: 'media-room', displayName: 'B', photoURL: '' });
      });

      // Toggle media
      const toggleData = await new Promise<any>((resolve) => {
        c2.on('peer-media-toggle', (data) => resolve(data));
        c1.emit('toggle-media', { kind: 'audio', enabled: false });
      });

      expect(toggleData.kind).toBe('audio');
      expect(toggleData.enabled).toBe(false);

      c1.disconnect();
      c2.disconnect();
    });
  });

  describe('chat', () => {
    it('should relay chat messages with display name', async () => {
      const c1 = await createClient();
      const c2 = await createClient();

      await new Promise<void>((resolve) => {
        c1.on('room-joined', () => resolve());
        c1.emit('join-room', { meetingId: 'chat-room', displayName: 'Alice', photoURL: '' });
      });

      await new Promise<void>((resolve) => {
        c2.on('room-joined', () => resolve());
        c2.emit('join-room', { meetingId: 'chat-room', displayName: 'Bob', photoURL: '' });
      });

      const chatData = await new Promise<any>((resolve) => {
        c2.on('peer-chat-message', (data) => resolve(data));
        c1.emit('chat-message', { message: 'Hello!' });
      });

      expect(chatData.displayName).toBe('Alice');
      expect(chatData.message).toBe('Hello!');
      expect(chatData.id).toBeDefined();
      expect(chatData.timestamp).toBeDefined();

      c1.disconnect();
      c2.disconnect();
    });
  });

  describe('screen sharing', () => {
    it('should relay screen share toggle to peers', async () => {
      const c1 = await createClient();
      const c2 = await createClient();

      await new Promise<void>((resolve) => {
        c1.on('room-joined', () => resolve());
        c1.emit('join-room', { meetingId: 'screen-room', displayName: 'A', photoURL: '' });
      });

      await new Promise<void>((resolve) => {
        c2.on('room-joined', () => resolve());
        c2.emit('join-room', { meetingId: 'screen-room', displayName: 'B', photoURL: '' });
      });

      const shareData = await new Promise<any>((resolve) => {
        c2.on('peer-screen-share', (data) => resolve(data));
        c1.emit('toggle-screen-share', { sharing: true });
      });

      expect(shareData.sharing).toBe(true);

      c1.disconnect();
      c2.disconnect();
    });
  });
});
