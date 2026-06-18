# samvyo-minimal-demo-app

A minimal browser-based video conferencing demo built on the [Samvyo JS SDK](https://www.npmjs.com/package/samvyo-js). It shows how to integrate real-time audio/video, screen sharing, live captions, and moderator controls into a web app in a single HTML + JS file.

---

## Features

- **Lobby** — enter a Room ID and display name, then join as a Participant or Moderator
- **Audio / Video** — real-time WebRTC streams with mute, unmute, and camera on/off controls
- **Screen sharing** — share your screen with an auto-featured main view and a participant sidebar for multiple simultaneous shares
- **Live captions** — real-time speech-to-text transcription overlay powered by Deepgram
- **Device settings** — switch microphone and camera mid-call from a settings panel
- **Moderator controls** — close the room for all participants, allow or deny join requests when authentication is enabled
- **Dynamic peer grid** — responsive tile layout that adapts as participants join and leave

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express (HTTPS) |
| Frontend | Vanilla HTML / JS, Tailwind CSS (CDN) |
| SDK | `samvyo-js-sdk` (loaded from unpkg) |
| Styling icons | Google Material Symbols |

---

## Prerequisites

- Node.js 18+
- A Samvyo account with an **Access Key** and **Secret Access Key**
- TLS certificate files (`server.key` and `server.crt`) — required because WebRTC needs a secure origin

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your Samvyo credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
ACCESS_KEY=<your-access-key>
SECRET_ACCESS_KEY=<your-secret-access-key>
```

### 3. Add TLS certificates

Place your certificate files in the project root:

```
server.key
server.crt
```

For local development you can generate a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes
```

### 4. Start the server

```bash
npm run start
```

The server starts on `https://localhost:3600` (or the port set in `PORT` env var).

---

## Usage

1. Open `https://localhost:3600` in a browser.
2. Enter a **Room ID** and your **display name**.
3. Optionally toggle **Join as Moderator** to get room-close and authentication controls.
4. Click **Join Room** — the app fetches a session token from the backend and connects via the Samvyo SDK.

In-call controls (bottom bar):

| Button | Action |
|---|---|
| Mic | Mute / unmute microphone |
| Camera | Turn camera on / off |
| Present | Start / stop screen share |
| Leave | Leave the call |
| Settings | Switch audio/video input device |
| Close | Close the room for everyone (Moderator only) |

---

## Advanced URL parameters

You can tune media settings by appending query parameters to the URL:

| Parameter | Default | Description |
|---|---|---|
| `videoResolution` | `hd` | Webcam resolution (`hd`, `sd`, etc.) |
| `produce` | `true` | Enable sending audio+video |
| `produceAudio` | `true` | Enable sending audio |
| `produceVideo` | `true` | Enable sending video |
| `forceH264` | `false` | Force H.264 video codec |
| `forcePCMU` | `false` | Force PCMU audio codec |
| `h264Profile` | `high` | H.264 profile (`high` or `low`) |
| `forceFPS` | `30` | Target frame rate (1–60) |
| `enableWebcamLayers` | `true` | Enable simulcast layers for webcam |
| `numSimulcastStreams` | `3` | Number of simulcast streams (1–3) |
| `videoBitRateHigh` | `500` | High-quality bitrate kbps (50–1000) |
| `videoBitRateMedium` | `250` | Mid-quality bitrate kbps (30–300) |
| `videoBitRateLow` | `100` | Low-quality bitrate kbps (10–125) |
| `autoGainControl` | `true` | Browser automatic gain control |
| `echoCancellation` | `true` | Browser echo cancellation |
| `noiseSuppression` | `true` | Browser noise suppression |
| `sampleRate` | `44000` | Audio sample rate Hz (8000–64000) |
| `channelCount` | `1` | Audio channel count (1–8) |
| `role` | `participant` | Join role (`moderator` or `participant`) |
| `auth` | `false` | Require moderator approval to join |
| `password` | — | Room password (when auth is enabled) |

Example:

```
https://localhost:3600?role=moderator&forceH264=true&videoBitRateHigh=800
```

---

## Docker deployment

Build and push a Docker image using the provided script:

```bash
./deploy.sh dev    # uses .env.dev
./deploy.sh prod   # uses .env.prod
```

The script expects the following variables in your env file:

```
CI_REGISTRY_USER
CI_REGISTRY_PASSWORD
CI_REGISTRY
VERSION
SDK_ACCESS_KEY
SDK_SECRET_ACCESS_KEY
```

To build manually:

```bash
docker build \
  --build-arg SDK_ACCESS_KEY=<key> \
  --build-arg SDK_SECRET_ACCESS_KEY=<secret> \
  -t samvyo-demo:latest .

docker run -p 3600:3600 samvyo-demo:latest
```

---

## Project structure

```
samvyo-minimal-demo-app/
├── server.js          # Express HTTPS server — serves static files and the session-token API
├── public/
│   ├── index.html     # Single-page UI (lobby + call views)
│   └── script.js      # Samvyo SDK integration and all call logic
├── .env.example       # Environment variable template
├── dockerfile         # Docker build definition
├── deploy.sh          # Manual build-and-push script
└── package.json
```

---

## API endpoint

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-session-token` | Exchanges `roomId` + SDK credentials for a Samvyo session token |

The frontend calls this endpoint before initialising the SDK so that credentials never leave the server.
