"""
Audio-service API.

- WebSocket /midi  — receives JSON note events from ai-service
- GET /state       — returns service health / queue state
- Static /hls/     — serves HLS segments for the browser
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

mimetypes.add_type("application/vnd.apple.mpegurl", ".m3u8")
mimetypes.add_type("video/mp2t", ".ts")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.midi_bridge import MidiBridge

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [audio] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

HLS_DIR = os.environ.get("HLS_DIR", "/hls")

bridge = MidiBridge(hls_dir=HLS_DIR)

last_event_time: float = 0.0
last_heartbeat: dict | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    bridge.start()
    yield
    bridge.stop()


app = FastAPI(lifespan=lifespan)

# Serve HLS segments
Path(HLS_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/hls", StaticFiles(directory=HLS_DIR), name="hls")


@app.websocket("/midi")
async def midi_ws(ws: WebSocket) -> None:
    global last_event_time, last_heartbeat
    await ws.accept()
    log.info("ai-service connected via WebSocket.")
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg["type"] == "chunk":
                bridge.schedule_chunk(
                    notes=msg["notes"],
                    chunk_start=msg["chunk_start"],
                    chunk_end=msg["chunk_end"],
                )
                last_event_time = time.monotonic()

            elif msg["type"] == "heartbeat":
                last_heartbeat = msg
                last_event_time = time.monotonic()

    except WebSocketDisconnect:
        log.warning("ai-service disconnected.")


@app.get("/state")
async def state() -> JSONResponse:
    now = time.monotonic()
    return JSONResponse({
        "stream_start": bridge.stream_start,
        "playback_cursor": bridge.playback_cursor,
        "queue_depth": bridge.queue_depth,
        "last_event_age_ms": round((now - last_event_time) * 1000) if last_event_time else None,
        "last_heartbeat": last_heartbeat,
        "hls_ready": Path(HLS_DIR, "stream.m3u8").exists(),
    })
