"""
FluidSynth-based MIDI renderer.

Receives note events from the AI service, schedules them on FluidSynth,
and continuously renders audio to a raw PCM pipe that ffmpeg reads for
HLS encoding.  No JACK required.
"""

from __future__ import annotations

import heapq
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

import fluidsynth
import imageio_ffmpeg

log = logging.getLogger(__name__)

SAMPLE_RATE = 48000
BUFFER_FRAMES = 1024
# Debian package fluidr3mono-gm-soundfont installs SF3 here (not sf2/FluidR3Mono_GM.sf2).
DEFAULT_SOUNDFONT = "/usr/share/sounds/sf3/FluidR3Mono_GM.sf3"

NOTE_ON = 0x90
NOTE_OFF = 0x80


class MidiBridge:
    """Renders MIDI to HLS via FluidSynth + ffmpeg."""

    def __init__(self, hls_dir: str = "/hls") -> None:
        self._queue: list[tuple[float, int, tuple[int, ...]]] = []
        self._seq = 0
        self._lock = threading.Lock()
        self._stream_start: float | None = None
        self._playback_cursor: float = 0.0
        self._running = False
        self._hls_dir = hls_dir

        self._fs: fluidsynth.Synth | None = None
        self._ffmpeg: subprocess.Popen | None = None

    @property
    def queue_depth(self) -> int:
        return len(self._queue)

    @property
    def stream_start(self) -> float | None:
        return self._stream_start

    @property
    def playback_cursor(self) -> float:
        return self._playback_cursor

    def start(self) -> None:
        soundfont = os.environ.get("SOUNDFONT", DEFAULT_SOUNDFONT)
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        log.info("Initialising FluidSynth (SR=%d) …", SAMPLE_RATE)
        self._fs = fluidsynth.Synth(samplerate=float(SAMPLE_RATE), gain=0.6)
        sfid = self._fs.sfload(soundfont)
        if sfid == -1:
            raise RuntimeError(
                f"FluidSynth could not load soundfont {soundfont!r} "
                "(check SOUNDFONT path and that the file exists in the image)."
            )
        self._fs.program_select(0, sfid, 0, 0)  # channel 0, bank 0, program 0 (Grand Piano)
        log.info("SoundFont loaded: %s (sfid=%d)", soundfont, sfid)

        Path(self._hls_dir).mkdir(parents=True, exist_ok=True)

        self._ffmpeg = subprocess.Popen(
            [
                ffmpeg_exe, "-y",
                "-f", "s16le",
                "-ar", str(SAMPLE_RATE),
                "-ac", "2",
                "-i", "pipe:0",
                "-c:a", "aac",
                "-b:a", "128k",
                "-f", "hls",
                "-hls_time", "2",
                "-hls_list_size", "10",
                "-hls_flags", "delete_segments",
                "-hls_segment_filename", f"{self._hls_dir}/stream%d.ts",
                f"{self._hls_dir}/stream.m3u8",
            ],
            stdin=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        log.info("ffmpeg HLS encoder started (pid=%d).", self._ffmpeg.pid)

        self._running = True
        t = threading.Thread(target=self._render_loop, daemon=True)
        t.start()
        log.info("Render loop started (waiting for first chunk to set clock).")

    def schedule_chunk(
        self,
        notes: list[dict],
        chunk_start: float,
        chunk_end: float,
    ) -> None:
        if self._stream_start is None:
            self._stream_start = time.monotonic()
            log.info("Stream clock started (first chunk received).")

        now_s = time.monotonic() - self._stream_start
        play_at = max(self._playback_cursor, now_s)
        chunk_dur = chunk_end - chunk_start

        for n in notes:
            relative = n["t"] - chunk_start
            onset = play_at + relative
            dur = n.get("duration", 0.5)
            pitch = n["pitch"]
            vel = n.get("velocity", 80)

            with self._lock:
                heapq.heappush(self._queue, (onset, self._seq, (NOTE_ON, pitch, vel)))
                self._seq += 1
                heapq.heappush(self._queue, (onset + dur, self._seq, (NOTE_OFF, pitch, 0)))
                self._seq += 1

        self._playback_cursor = play_at + chunk_dur
        log.info(
            "Scheduled %d notes at %.1f–%.1f s (cursor now %.1f s)",
            len(notes), play_at, play_at + chunk_dur, self._playback_cursor,
        )

    def _render_loop(self) -> None:
        """Continuously render audio and pipe to ffmpeg."""
        assert self._fs is not None
        assert self._ffmpeg is not None and self._ffmpeg.stdin is not None

        chunk_duration_s = BUFFER_FRAMES / SAMPLE_RATE

        while self._running:
            if self._stream_start is None:
                # No notes yet — render silence to keep ffmpeg fed
                samples = self._fs.get_samples(BUFFER_FRAMES)
                try:
                    # get_samples() returns int16 stereo (see fluid_synth_write_s16_stereo)
                    self._ffmpeg.stdin.write(fluidsynth.raw_audio_string(samples))
                except BrokenPipeError:
                    log.error("ffmpeg pipe broken.")
                    break
                time.sleep(chunk_duration_s)
                continue

            now_s = time.monotonic() - self._stream_start

            with self._lock:
                while self._queue and self._queue[0][0] <= now_s:
                    _, _, (status, pitch, vel) = heapq.heappop(self._queue)
                    if status == NOTE_ON:
                        self._fs.noteon(0, pitch, vel)
                    else:
                        self._fs.noteoff(0, pitch)

            samples = self._fs.get_samples(BUFFER_FRAMES)
            try:
                self._ffmpeg.stdin.write(fluidsynth.raw_audio_string(samples))
            except BrokenPipeError:
                log.error("ffmpeg pipe broken.")
                break

            time.sleep(chunk_duration_s * 0.8)

    def stop(self) -> None:
        self._running = False
        if self._ffmpeg and self._ffmpeg.stdin:
            self._ffmpeg.stdin.close()
            self._ffmpeg.wait(timeout=5)
        if self._fs:
            self._fs.delete()
