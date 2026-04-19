"""
AI service entry-point.

Loads a music generator, connects to the audio-service WebSocket, and pushes
note events in an endless loop, keeping a configurable lookahead buffer
ahead of the real-time playhead.

Set GENERATOR=amt to use the Anticipatory Music Transformer (requires
significant CPU/GPU).  Default is "algo" — a fast algorithmic generator
that lets you verify the full pipeline immediately.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ai] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

AUDIO_WS = os.environ.get("AUDIO_WS", "ws://audio-service:8001/midi")
LOOKAHEAD_S = float(os.environ.get("LOOKAHEAD_S", "6.0"))
GENERATOR = os.environ.get("GENERATOR", "algo")
HEARTBEAT_INTERVAL_S = 2.0


def _make_generator():
    if GENERATOR == "amt":
        from app.generator import MidiGenerator
        return MidiGenerator(chunk_seconds=3.0, overlap_seconds=2.0, top_p=0.95)
    else:
        from app.algo_generator import AlgoGenerator
        return AlgoGenerator(chunk_seconds=3.0, bpm=90.0)


async def run() -> None:
    gen = _make_generator()

    while True:
        try:
            log.info("Connecting to %s …", AUDIO_WS)
            async with websockets.connect(AUDIO_WS, ping_interval=20) as ws:
                log.info("Connected.")
                stream_start = time.monotonic()
                last_heartbeat = 0.0

                while True:
                    playhead = time.monotonic() - stream_start
                    generated_through = gen.cursor_s

                    if generated_through - playhead >= LOOKAHEAD_S:
                        now = time.monotonic()
                        if now - last_heartbeat >= HEARTBEAT_INTERVAL_S:
                            await ws.send(json.dumps({
                                "type": "heartbeat",
                                "generated_through": round(generated_through, 3),
                                "playhead": round(playhead, 3),
                            }))
                            last_heartbeat = now
                        await asyncio.sleep(0.25)
                        continue

                    start = gen.cursor_s
                    loop = asyncio.get_running_loop()
                    notes = await loop.run_in_executor(None, gen.next_chunk)

                    chunk_msg = json.dumps({
                        "type": "chunk",
                        "chunk_start": round(start, 4),
                        "chunk_end": round(gen.cursor_s, 4),
                        "notes": [
                            {
                                "t": round(n.onset_s, 4),
                                "pitch": n.pitch,
                                "velocity": n.velocity,
                                "duration": round(n.duration_s, 4),
                            }
                            for n in notes
                        ],
                    })
                    await ws.send(chunk_msg)

                    log.info(
                        "Sent chunk with %d notes (music %.1f–%.1f s, wall %.1f s)",
                        len(notes),
                        start,
                        gen.cursor_s,
                        time.monotonic() - stream_start,
                    )

        except (
            websockets.ConnectionClosed,
            ConnectionRefusedError,
            OSError,
        ) as exc:
            log.warning("Connection lost (%s), retrying in 3 s …", exc)
            await asyncio.sleep(3)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
