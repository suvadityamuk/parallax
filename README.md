# Parallax

Real-time 3D video meetings with WebRTC, anaglyph stereo, and Gaussian splatting.

## Quick Start

### Prerequisites
- Node.js 22+
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

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project
2. Enable **Authentication** → Sign-in method → **Google**
3. Enable **Cloud Firestore** (start in test mode)
4. Go to Project Settings → General → Your apps → **Add web app**
5. Copy the config values into `client/.env`

### 4. Run locally

```bash
npm run dev
```

This starts both:
- **Client** at `http://localhost:3000`
- **Server** at `http://localhost:4000`

### 5. Create a meeting

1. Open `http://localhost:3000`
2. Sign in with Google
3. Click **New Meeting** or share the link with a peer

## Project Structure

```
parallax/
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── contexts/       # React contexts (Auth)
│   │   ├── hooks/          # Custom hooks (network quality, toasts)
│   │   ├── lib/            # Firebase config
│   │   ├── pages/          # Landing, Meeting
│   │   ├── services/       # Signaling service
│   │   └── styles/         # CSS design system
│   ├── Dockerfile
│   └── nginx.conf
├── server/                 # Node.js signaling server
│   ├── src/
│   │   ├── index.ts        # Express + Socket.io entry
│   │   └── signaling.ts    # Room management, WebRTC relay
│   └── Dockerfile
├── infra/
│   └── coturn/             # TURN server config
└── package.json            # Monorepo root
```

## Viewing Modes

| Mode | Status | Description |
|---|---|---|
| 🎥 **Normal** | ✅ Ready | Standard 2D WebRTC video |
| 👓 **Anaglyph** | 🚧 Phase 2 | Server-side depth → stereo 3D (4 glasses types) |
| 🧊 **3D** | 🚧 Phase 3 | Live Gaussian Splatting (±30° free viewpoint) |

## Deployment

### Docker (production)

```bash
# Build images
docker build -t parallax-client ./client
docker build -t parallax-server ./server

# Run
docker run -p 80:80 parallax-client
docker run -p 4000:4000 --env-file server/.env parallax-server
```

### GCP (target)

- **Client**: Firebase Hosting (static SPA)
- **Server**: Cloud Run (signaling + SFU)
- **TURN**: GCE VM with coturn (`infra/coturn/turnserver.conf`)
- **GPU Worker**: GKE with T4 node pool (Phase 2+)

## License

MIT
