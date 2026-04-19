# Parallax

Real-time 3D video meetings with WebRTC, anaglyph stereo, and Gaussian splatting.

## Table of Contents

- [Quick Start (Local Development)](#quick-start-local-development)
- [Project Structure](#project-structure)
- [Features](#features)
- [Scripts](#scripts)
- [Production Deployment](#production-deployment)
  - [Network Topology](#network-topology)
  - [1. Firebase (Auth + Hosting)](#1-firebase-auth--hosting)
  - [2. TURN Server (coturn)](#2-turn-server-coturn)
  - [3. Signaling Server (Cloud Run)](#3-signaling-server-cloud-run)
  - [4. GPU Worker (optional)](#4-gpu-worker-optional)
  - [5. Docker Compose (alternative)](#5-docker-compose-alternative)
  - [6. CI/CD](#6-cicd)
- [Environment Variable Reference](#environment-variable-reference)
- [Troubleshooting](#troubleshooting)

---

## Quick Start (Local Development)

### Prerequisites

| Tool | Version | Required For |
|------|---------|-------------|
| Node.js | 22+ | Client & Server |
| npm | 10+ | Monorepo workspaces |
| Python | 3.11+ | GPU Worker (optional) |
| Firebase CLI | latest | Hosting deployment (optional) |
| gcloud CLI | latest | Cloud Run deployment (optional) |

### 1. Clone and install

```bash
git clone https://github.com/suvadityamuk/parallax.git && cd parallax
npm install
```

### 2. Configure environment

```bash
# Client — Firebase config (required)
cp client/.env.example client/.env

# Server — TURN credentials + GPU worker URL (required)
cp server/.env.example server/.env

# GPU Worker — depth estimation settings (optional)
cp gpu-worker/.env.example gpu-worker/.env
```

### 3. Firebase project setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project
2. Enable **Authentication** → Sign-in method → **Google**
3. Enable **Cloud Firestore** → Create database → Start in **test mode**
4. Go to **Project Settings** → General → "Your apps" → click **Add app** → **Web** (`</>`)
5. Register the app (no hosting needed yet), and copy the `firebaseConfig` values
6. Paste them into `client/.env`:
   ```env
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc123
   ```

### 4. Run locally

```bash
# Client + Server only (Normal video mode — no GPU features)
npm run dev

# Full stack including GPU worker (enables Anaglyph + 3D modes)
npm run dev:all
```

This starts:

| Service | URL | Notes |
|---------|-----|-------|
| Client | `http://localhost:3000` | React + Vite dev server |
| Server | `http://localhost:4000` | Socket.io signaling |
| GPU Worker | `http://localhost:8000` | Only with `dev:all` |

> **Note:** Local development uses Google's public STUN servers by default. STUN works for most same-network and direct-internet connections. A TURN server is only required when peers are behind symmetric NATs or restrictive firewalls (common in corporate networks / mobile carriers).

### 5. Create a meeting

1. Open `http://localhost:3000`
2. Sign in with Google
3. Click **New Meeting** to generate a meeting code, or enter an existing one
4. Share the meeting link with a peer — they'll join the same room

---

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
│   │   └── __tests__/      # Unit tests (vitest)
│   ├── Dockerfile          # nginx-based production image
│   └── nginx.conf
├── server/                 # Node.js signaling server
│   ├── src/
│   │   ├── index.ts        # Express + Socket.io entry
│   │   ├── signaling.ts    # Room management, WebRTC relay, chat, screen share
│   │   ├── gpu-proxy.ts    # GPU worker HTTP proxy
│   │   └── __tests__/      # Integration tests (vitest)
│   └── Dockerfile
├── gpu-worker/             # Python GPU worker (FastAPI + OpenCV + PyTorch)
│   ├── src/
│   │   ├── main.py         # FastAPI app (health, anaglyph, splat endpoints)
│   │   ├── depth.py        # MiDaS / FlashDepth depth estimation
│   │   ├── anaglyph.py     # DIBR warp + Dubois compositing
│   │   ├── segmentation.py # MediaPipe selfie segmentation
│   │   ├── optical_flow.py # Farneback motion detection
│   │   ├── splat_generator.py # Gaussian Splatting pipeline
│   │   └── config.py       # Environment configuration
│   ├── tests/              # pytest unit tests
│   └── Dockerfile          # Multi-stage (dev + CUDA prod)
├── infra/
│   └── coturn/
│       └── turnserver.conf # TURN server configuration template
├── .github/workflows/
│   └── ci.yml              # Lint → Type Check → Test → Build
├── docker-compose.yml      # Full-stack orchestration
├── firebase.json           # Firebase Hosting config (SPA rewrites)
└── package.json            # Monorepo root (npm workspaces)
```

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| 🎥 **HD Video** | ✅ Ready | WebRTC peer-to-peer video with ICE restart (3 attempts) |
| 👓 **Anaglyph 3D** | ✅ Ready | Server-side depth → stereo 3D (red/cyan, red/blue, green/magenta, amber/blue) |
| 🧊 **3D Splatting** | ✅ Ready | Live Gaussian Splatting with orbit controls (±30°) |
| 🖥️ **Screen Sharing** | ✅ Ready | `getDisplayMedia()` with track replacement |
| 💬 **In-Meeting Chat** | ✅ Ready | Ephemeral socket-based messaging with unread badge |
| 🎙️ **Recording** | ✅ Ready | Local MediaRecorder → `.webm` download |
| ⚙️ **Settings** | ✅ Ready | Glasses type, default mode, volume (persisted to Firestore) |
| 📊 **Network Monitor** | ✅ Ready | Bandwidth/latency-based auto-downgrade with 5s grace period |
| 🔄 **ICE Restart** | ✅ Ready | Auto-reconnect on `connectionState === 'failed'` |
| 🔐 **Auth** | ✅ Ready | Firebase Google Auth with sign-in/sign-out |

---

## Scripts

```bash
npm run dev        # Client + Server (no GPU)
npm run dev:all    # Client + Server + GPU Worker
npm run dev:gpu    # GPU Worker only (uvicorn)
npm run build      # Production build (client + server)
npm run lint       # ESLint (client + server)
npm run test       # All tests (client + server + gpu-worker)
npm run clean      # Remove node_modules and build artifacts
```

---

## Production Deployment

### Network Topology

```
                    ┌─────────────────────┐
                    │   Firebase Hosting   │
                    │   (Static SPA)       │
                    │   client/dist        │
                    └──────────┬──────────┘
                               │ HTTPS
                    ┌──────────▼──────────┐          ┌──────────────────┐
  Browser ◄────────►│   Cloud Run          │◄────────►│   GPU Worker     │
  (WebRTC)          │   (Signaling Server) │  HTTP    │   (FastAPI)      │
                    │   Socket.io + REST   │          │   MiDaS / 3DGS   │
                    └──────────┬──────────┘          └──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   GCE VM             │
                    │   coturn TURN Server  │
                    │   UDP 49152-65535     │
                    └─────────────────────┘
```

**Data flow:**
1. Client loads from Firebase Hosting
2. Client connects to signaling server via WebSocket (Socket.io)
3. Server provides ICE servers (STUN + TURN) on `room-joined`
4. Peers establish direct WebRTC connections (media goes peer-to-peer, not through the server)
5. When Anaglyph or 3D mode is active, frames are sent via the signaling server to the GPU worker for processing

---

### 1. Firebase (Auth + Hosting)

#### a. Initial setup (if not done)

```bash
# Install the Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Associate this directory with your Firebase project
firebase use --add
# Select your project from the list
```

#### b. Deploy the client

```bash
# Build the production client bundle
npm run build --workspace=client

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

Your client will be live at `https://<project-id>.web.app`.

#### c. Update authorized domains

In Firebase Console → **Authentication** → **Settings** → **Authorized domains**, add:
- Your production domain (if using a custom domain)
- `<project-id>.web.app` (should be added automatically)

#### d. Firestore security rules (production)

Replace the test-mode rules with scoped rules. In Firebase Console → **Firestore** → **Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

### 2. TURN Server (coturn)

> **Why you need this:** WebRTC requires STUN to discover public IPs, but STUN fails when peers are behind symmetric NATs (corporate networks, mobile carriers, most cloud VMs). A TURN server relays media traffic as a fallback, ensuring **100% connectivity** between any two peers.

#### a. Provision a GCE VM

```bash
# Create a static external IP
gcloud compute addresses create parallax-turn-ip \
  --region=us-west1

# Note the IP — you'll need it below
gcloud compute addresses describe parallax-turn-ip \
  --region=us-west1 --format='get(address)'

# Create the VM
gcloud compute instances create parallax-turn \
  --zone=us-west1-b \
  --machine-type=e2-medium \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --address=parallax-turn-ip \
  --tags=turn-server \
  --boot-disk-size=20GB
```

#### b. Open firewall ports

coturn needs several ports open. Create a firewall rule:

```bash
gcloud compute firewall-rules create allow-turn \
  --direction=INGRESS \
  --action=ALLOW \
  --target-tags=turn-server \
  --rules=tcp:3478,udp:3478,tcp:5349,udp:5349,udp:49152-65535 \
  --source-ranges=0.0.0.0/0 \
  --description="Allow TURN/STUN traffic for Parallax"
```

| Port | Protocol | Purpose |
|------|----------|---------|
| 3478 | TCP + UDP | STUN/TURN standard port |
| 5349 | TCP + UDP | TURN over TLS (TURNS) |
| 49152–65535 | UDP | Media relay port range |

#### c. Install coturn

```bash
# SSH into the VM
gcloud compute ssh parallax-turn --zone=us-west1-b

# Install coturn
sudo apt update && sudo apt install -y coturn

# Enable coturn as a system service
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

#### d. Configure coturn

Copy the template from this repo and fill in your values:

```bash
sudo cp /etc/turnserver.conf /etc/turnserver.conf.bak
sudo nano /etc/turnserver.conf
```

Paste the following (replace placeholders):

```ini
# ── coturn configuration for Parallax ──

# General
realm=parallax.app
server-name=parallax-turn
fingerprint
lt-cred-mech

# Ports
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

# Network — replace with your VM IPs
# Find internal IP: curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip -H "Metadata-Flavor: Google"
relay-ip=<INTERNAL_IP>
external-ip=<EXTERNAL_IP>/<INTERNAL_IP>

# Security
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
no-cli

# Logging
log-file=/var/log/coturn/turnserver.log
verbose

# Users — create a long-term credential
user=parallax:<STRONG_PASSWORD>

# TLS (add after setting up Let's Encrypt — see step e)
# cert=/etc/letsencrypt/live/turn.parallax.app/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.parallax.app/privkey.pem
```

**To find your VM's IPs:**
```bash
# Internal IP (from inside the VM)
curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip \
  -H "Metadata-Flavor: Google"

# External IP (from inside the VM)
curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  -H "Metadata-Flavor: Google"

# Or from your local machine
gcloud compute addresses describe parallax-turn-ip \
  --region=us-west1 --format='get(address)'
```

#### e. TLS with Let's Encrypt (recommended)

TURNS (TURN over TLS on port 5349) is required for peers behind firewalls that block non-HTTPS traffic. If you have a domain (e.g. `turn.parallax.app`):

```bash
# Point your DNS A record: turn.parallax.app → <EXTERNAL_IP>

# Install certbot
sudo apt install -y certbot

# Get a certificate (standalone — temporarily stop coturn if it's running)
sudo systemctl stop coturn
sudo certbot certonly --standalone -d turn.parallax.app --agree-tos -m your@email.com
sudo systemctl start coturn
```

Then uncomment the TLS lines in `/etc/turnserver.conf`:
```ini
cert=/etc/letsencrypt/live/turn.parallax.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn.parallax.app/privkey.pem
```

Set up auto-renewal:
```bash
# Certbot auto-renews via systemd timer — verify it's active
sudo systemctl status certbot.timer

# Add a post-renewal hook to restart coturn
sudo mkdir -p /etc/letsencrypt/renewal-hooks/post
sudo tee /etc/letsencrypt/renewal-hooks/post/restart-coturn.sh << 'EOF'
#!/bin/bash
systemctl restart coturn
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/restart-coturn.sh
```

#### f. Start and verify coturn

```bash
# Start coturn
sudo systemctl restart coturn
sudo systemctl enable coturn

# Check it's running
sudo systemctl status coturn

# Check the log
sudo tail -f /var/log/coturn/turnserver.log
```

**Verify from your local machine:**
```bash
# Test STUN binding (requires stunclient — brew install stuntman / apt install stuntman-client)
stunclient <EXTERNAL_IP> 3478

# Or use Trickle ICE in the browser:
# https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# Add server: turn:<EXTERNAL_IP>:3478  username: parallax  credential: <password>
# Click "Gather candidates" — you should see a relay candidate
```

#### g. Configure the signaling server

Add the TURN credentials to `server/.env`:

```env
# Without TLS
TURN_URL=turn:<EXTERNAL_IP>:3478
TURN_USER=parallax
TURN_PASS=<STRONG_PASSWORD>

# With TLS (recommended for production)
TURN_URL=turns:turn.parallax.app:5349
TURN_USER=parallax
TURN_PASS=<STRONG_PASSWORD>
```

The server automatically includes these in the ICE server list sent to clients on `room-joined` (see `getIceServers()` in `server/src/signaling.ts`).

---

### 3. Signaling Server (Cloud Run)

The signaling server is a stateless Node.js app with Socket.io. Cloud Run supports WebSocket connections.

#### a. Build and deploy

```bash
# Deploy directly from source
gcloud run deploy parallax-server \
  --source ./server \
  --region us-west1 \
  --allow-unauthenticated \
  --port 4000 \
  --min-instances 1 \
  --set-env-vars "PORT=4000,CLIENT_URL=https://<project-id>.web.app,GPU_WORKER_URL=http://<gpu-worker-ip>:8000" \
  --set-env-vars "TURN_URL=turns:turn.parallax.app:5349,TURN_USER=parallax,TURN_PASS=<password>"
```

> **Important:** Set `--min-instances 1` to avoid cold starts on WebSocket connections. Socket.io requires sticky sessions — Cloud Run handles this automatically for single-instance deployments.

#### b. Update the client

Set the server URL in `client/.env` before rebuilding:

```env
VITE_SERVER_URL=https://parallax-server-<hash>-uw.a.run.app
```

Then rebuild and redeploy the client:

```bash
npm run build --workspace=client
firebase deploy --only hosting
```

---

### 4. GPU Worker (optional)

The GPU worker is only needed for Anaglyph 3D and 3D Gaussian Splatting modes. Normal video works without it.

#### Option A: Cloud VM with GPU

```bash
# Create a GPU VM (T4 is cost-effective)
gcloud compute instances create parallax-gpu \
  --zone=us-west1-b \
  --machine-type=n1-standard-4 \
  --accelerator=type=nvidia-tesla-t4,count=1 \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --maintenance-policy=TERMINATE \
  --boot-disk-size=50GB

# SSH in and install dependencies
gcloud compute ssh parallax-gpu --zone=us-west1-b

# Install NVIDIA drivers + CUDA
sudo apt update && sudo apt install -y nvidia-driver-535
# (reboot, then verify with nvidia-smi)

# Clone repo and start worker
git clone https://github.com/suvadityamuk/parallax.git && cd parallax/gpu-worker
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set DEPTH_BACKEND=midas, MIDAS_MODEL_TYPE=DPT_Hybrid (better quality with GPU)
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

#### Option B: Docker with GPU passthrough

```bash
cd gpu-worker
docker build -t parallax-gpu-worker --target prod .
docker run --gpus all -p 8000:8000 --env-file .env parallax-gpu-worker
```

#### Option C: CPU-only (development / low quality)

MiDaS_small runs on CPU. No GPU needed:

```bash
cd gpu-worker
pip install -r requirements.txt
DEPTH_BACKEND=midas MIDAS_MODEL_TYPE=MiDaS_small uvicorn src.main:app --host 0.0.0.0 --port 8000
```

---

### 5. Docker Compose (alternative)

Run the full stack locally or on a single VM with Docker Compose:

```bash
# Client + Server only (Normal video mode)
docker compose up

# Full stack with GPU worker
docker compose --profile gpu up

# Build individually
docker build -t parallax-client ./client
docker build -t parallax-server ./server
docker build -t parallax-gpu-worker ./gpu-worker
```

> **Note:** For GPU passthrough in Docker Compose, uncomment the `deploy.resources.reservations` block in `docker-compose.yml` and ensure the NVIDIA Container Toolkit is installed on the host.

---

### 6. CI/CD

A GitHub Actions workflow is configured at `.github/workflows/ci.yml`. It runs on every push and PR to `main`:

1. **Lint** — ESLint on client and server
2. **Type check** — `tsc --noEmit` on client and server
3. **Test** — GPU worker pytest suite
4. **Build** — Production build of client and server

No additional setup needed — it runs automatically on GitHub.

---

## Environment Variable Reference

### Client (`client/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Yes | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | Firebase auth domain (`<project>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Yes | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Yes | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase sender ID |
| `VITE_FIREBASE_APP_ID` | Yes | Firebase app ID |
| `VITE_SERVER_URL` | No | Signaling server URL (default: `http://localhost:4000`) |

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `4000`) |
| `CLIENT_URL` | No | Client origin for CORS (default: `http://localhost:3000`) |
| `GPU_WORKER_URL` | No | GPU worker URL (default: `http://localhost:8000`) |
| `TURN_URL` | No | TURN server URL, e.g. `turn:1.2.3.4:3478` or `turns:turn.example.com:5349` |
| `TURN_USER` | No | TURN long-term credential username |
| `TURN_PASS` | No | TURN long-term credential password |

### GPU Worker (`gpu-worker/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPTH_BACKEND` | `midas` | Depth backend: `midas` or `flashdepth` (not yet implemented) |
| `MIDAS_MODEL_TYPE` | `MiDaS_small` | MiDaS model: `MiDaS_small`, `DPT_Hybrid`, `DPT_Large` |
| `PROCESS_WIDTH` | `640` | Frame resize width before depth estimation |
| `PROCESS_HEIGHT` | `360` | Frame resize height before depth estimation |
| `IPD_MM` | `65.0` | Inter-pupillary distance (mm) for stereo |
| `FOCAL_LENGTH_PX` | `500.0` | Virtual camera focal length (px) |
| `MAX_DISPARITY_PX` | `30` | Max horizontal pixel shift for stereo |
| `SPLAT_VOXEL_SIZE` | `0.02` | Voxel grid side length (meters) |
| `SPLAT_MAX_COUNT` | `40000` | Max Gaussians per frame |
| `DELTA_THRESHOLD` | `0.005` | Position change threshold for delta encoding |
| `BG_FLOW_EXTREME` | `50.0` | Optical flow magnitude triggering 2D fallback |
| `KEYFRAME_INTERVAL_S` | `3.0` | Seconds between forced keyframes |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Bind port |

---

## Troubleshooting

### WebRTC connection fails between peers

- **Same network?** STUN should work. Check browser console for ICE candidate errors.
- **Different networks?** You likely need a TURN server. Follow [section 2](#2-turn-server-coturn).
- **Corporate firewall?** Use TURNS (TLS on port 5349) — many firewalls only allow HTTPS traffic.
- **Verify TURN:** Use [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) to test your TURN server independently.

### Anaglyph / 3D mode shows "GPU worker unavailable"

- Ensure the GPU worker is running and reachable from the signaling server
- Check `GPU_WORKER_URL` in `server/.env`
- Test directly: `curl http://<gpu-worker>:8000/health`

### Firebase Authentication not working

- Ensure Google sign-in is enabled in Firebase Console → Authentication → Sign-in method
- Check that your domain is in the authorized domains list
- Verify all 6 `VITE_FIREBASE_*` env vars are set correctly in `client/.env`

### coturn not starting

```bash
# Check for config errors
sudo turnserver -c /etc/turnserver.conf --check-origin-consistency

# Common issues:
# - Port 3478 already in use: sudo lsof -i :3478
# - Missing log directory: sudo mkdir -p /var/log/coturn
# - Permission denied on certs: sudo chown turnserver:turnserver /etc/letsencrypt/...
```

### Docker Compose GPU worker fails

- Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- Uncomment the `deploy.resources.reservations` block in `docker-compose.yml`
- Verify: `docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi`

---

## License

MIT
