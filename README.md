# Parallax

Real-time 3D video meetings with WebRTC, anaglyph stereo, and Gaussian splatting.

## Quick Start

### Prerequisites
- Node.js 22+
- Python 3.11+ (for GPU worker, optional)
- A Firebase project with Auth and Firestore enabled

### 1. Clone and install

```bash
git clone <repo-url> parallax && cd parallax
npm install
```

### 2. Configure environment

**Client** — copy and fill in your Firebase config:
```bash
cp client/.env.example client/.env
```

**Server** — copy and optionally add TURN server credentials:
```bash
cp server/.env.example server/.env
```

**GPU Worker** (optional) — copy and adjust depth settings:
```bash
cp gpu-worker/.env.example gpu-worker/.env
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project
2. Enable **Authentication** → Sign-in method → **Google**
3. Enable **Cloud Firestore** (start in test mode)
4. Go to Project Settings → General → Your apps → **Add web app**
5. Copy the config values into `client/.env`

### 4. Run locally

```bash
# Client + Server only (no GPU features)
npm run dev

# Full stack including GPU worker
npm run dev:all
```

This starts:
- **Client** at `http://localhost:3000`
- **Server** at `http://localhost:4000`
- **GPU Worker** at `http://localhost:8000` (with `dev:all`)

### 5. Create a meeting

1. Open `http://localhost:3000`
2. Sign in with Google
3. Click **New Meeting** or share the link with a peer

## Project Structure

```
parallax/
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/     # ChatPanel, SplatViewer, ProtectedRoute
│   │   ├── contexts/       # React contexts (Auth + Preferences)
│   │   ├── hooks/          # useAnaglyph, useSplat, useNetworkQuality, useToast
│   │   ├── lib/            # Firebase config
│   │   ├── pages/          # Landing, Meeting, Settings
│   │   ├── services/       # Signaling service (Socket.io)
│   │   ├── styles/         # CSS design system
│   │   └── __tests__/      # Unit tests
│   ├── Dockerfile
│   └── nginx.conf
├── server/                 # Node.js signaling server
│   ├── src/
│   │   ├── index.ts        # Express + Socket.io entry
│   │   ├── signaling.ts    # Room management, WebRTC relay, chat, screen share
│   │   ├── gpu-proxy.ts    # GPU worker HTTP proxy
│   │   └── __tests__/      # Integration tests
│   └── Dockerfile
├── gpu-worker/             # Python GPU worker (FastAPI)
│   ├── src/
│   │   ├── main.py         # FastAPI app (endpoints)
│   │   ├── depth.py        # MiDaS depth estimation
│   │   ├── anaglyph.py     # DIBR warp + Dubois compositing
│   │   ├── segmentation.py # MediaPipe selfie segmentation
│   │   ├── optical_flow.py # Farneback motion detection
│   │   ├── splat_generator.py # 3DGS pipeline
│   │   └── config.py       # Environment configuration
│   ├── tests/              # pytest unit tests
│   └── Dockerfile
├── infra/
│   └── coturn/             # TURN server config
├── .github/workflows/      # CI pipeline
├── docker-compose.yml      # Full-stack orchestration
├── firebase.json           # Firebase Hosting config
└── package.json            # Monorepo root
```

## Features

| Feature | Status | Description |
|---|---|---|
| 🎥 **HD Video** | ✅ Ready | WebRTC peer-to-peer video with ICE restart |
| 👓 **Anaglyph 3D** | ✅ Ready | Server-side depth → stereo 3D (4 glasses types) |
| 🧊 **3D Splatting** | ✅ Ready | Live Gaussian Splatting (±30° orbit) |
| 🖥️ **Screen Sharing** | ✅ Ready | Share screen with track replacement |
| 💬 **In-Meeting Chat** | ✅ Ready | Ephemeral socket-based messaging |
| ⚙️ **Settings** | ✅ Ready | Glasses type, default mode, volume |
| 📊 **Network Monitor** | ✅ Ready | Bandwidth/latency-based auto-downgrade |
| 🔄 **ICE Restart** | ✅ Ready | Auto-reconnect on connection failure |

## Scripts

```bash
npm run dev        # Client + Server
npm run dev:all    # Client + Server + GPU Worker
npm run build      # Production build
npm run lint       # Lint all packages
npm run test       # Run all tests
npm run clean      # Clean all node_modules and build artifacts
```

## Deployment

### Docker (production)

```bash
# All services
docker compose up

# With GPU worker
docker compose --profile gpu up

# Or build individually
docker build -t parallax-client ./client
docker build -t parallax-server ./server
docker build -t parallax-gpu-worker ./gpu-worker
```

### GCP (target)

- **Client**: Firebase Hosting (static SPA)
- **Server**: Cloud Run (signaling)
- **TURN**: GCE VM with coturn (`infra/coturn/turnserver.conf`)
- **GPU Worker**: GKE with T4 node pool

## License

MIT
