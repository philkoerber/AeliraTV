# AeliraTV — Live AI Piano

A Docker Compose prototype that continuously generates piano music with an AI
model and streams it to the browser in real time.

## Architecture

```
┌──────────────┐   WebSocket (JSON notes)   ┌──────────────────┐   HLS   ┌──────────┐
│  ai-service  │ ─────────────────────────▶ │  audio-service   │ ──────▶ │ frontend │
│  (AMT model) │                            │  sfizz + JACK +  │         │ (React)  │
│  PyTorch CPU │                            │  ffmpeg → HLS    │         │  nginx   │
└──────────────┘                            └──────────────────┘         └──────────┘
```

| Service | What it does |
|---------|-------------|
| **ai-service** | Loads the [Anticipatory Music Transformer](https://github.com/jthickstun/anticipation) (`stanford-crfm/music-medium-800k`, 360 M params). Generates piano MIDI in 3 s chunks, keeping a 6 s lookahead buffer. Sends JSON note events over WebSocket. |
| **audio-service** | Runs a headless JACK server (dummy driver), sfizz with the [Salamander Grand Piano](https://github.com/sfzinstruments/SalamanderGrandPiano) SFZ, and ffmpeg encoding JACK audio to HLS. Exposes a `/midi` WebSocket for incoming notes and a `/state` health endpoint. |
| **frontend** | Vite + React + TypeScript. Uses hls.js to play the live stream. Shows play/stop, connection status, and an RMS + peak VU meter. Served by nginx which proxies `/hls/` and `/state` to audio-service. |

## Prerequisites

- **Docker** and **Docker Compose** v2+
- ~4 GB RAM (the AI model uses ~1.5 GB, sfizz + Salamander ~500 MB)
- First build downloads ~1 GB of piano samples and ~360 MB of model weights

## Quick start

```bash
docker compose up --build
```

Then open **http://localhost:8080** and click **Play**.

The AI service takes 30–60 s to load the model on first run. Once you see
`Sent N notes` in the logs, the audio pipeline is live.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIO_WS` | `ws://audio-service:8001/midi` | WebSocket URL the AI service connects to |
| `LOOKAHEAD_S` | `6.0` | How far ahead (in seconds) the AI generates before sleeping |
| `HLS_DIR` | `/hls` | Where ffmpeg writes HLS segments (shared volume) |

## Development (without Docker)

**Frontend** (hot-reload):
```bash
cd frontend && npm install && npm run dev
```

**Audio-service** requires a Linux host with JACK, sfizz, and ffmpeg installed.

**AI-service** requires Python 3.10+ with PyTorch:
```bash
cd ai-service && pip install .
python -m app.main
```

## Known limitations

- HLS adds 3–6 s of latency. This is by design (simplest transport).
- AMT on CPU runs at roughly 0.5–1.5x realtime. The 6 s lookahead covers
  brief stalls; on a very small VM, switch to `music-small-800k` for faster
  generation at slightly lower coherence.
- Salamander samples are ~500 MB. The first `docker build` will take a while.

## License

The prototype code in this repo is MIT. The AMT model is Apache 2.0.
Salamander Grand Piano samples are CC-BY 3.0.
