"""
Fast algorithmic piano generator for prototype/demo use.

Produces musically coherent piano patterns instantly on CPU — no model
download, no GPU.  Intended as the default generator so the full pipeline
(MIDI → sfizz → HLS → browser) can be verified in seconds.

Switch to MidiGenerator (AMT) for AI-generated music once a GPU is available.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass

log = logging.getLogger(__name__)

SCALES = {
    "C_major":  [60, 62, 64, 65, 67, 69, 71],
    "A_minor":  [57, 59, 60, 62, 64, 65, 67],
    "D_minor":  [62, 64, 65, 67, 69, 70, 72],
    "F_major":  [65, 67, 69, 70, 72, 74, 76],
    "G_major":  [55, 57, 59, 60, 62, 64, 66],
}

CHORD_PATTERNS = [
    [0, 2, 4],       # triad
    [0, 2, 4, 6],    # seventh
    [0, 4],           # fifth
]

RHYTHM_CELLS = [
    [0.5],
    [0.25, 0.25],
    [0.375, 0.125],
    [0.75, 0.25],
    [1.0],
]


@dataclass(slots=True)
class NoteEvent:
    onset_s: float
    pitch: int
    velocity: int
    duration_s: float


class AlgoGenerator:
    """Generates endless piano patterns in real-time chunks."""

    def __init__(
        self,
        chunk_seconds: float = 3.0,
        bpm: float = 90.0,
        seed: int | None = None,
    ):
        self.chunk_s = chunk_seconds
        self.beat_s = 60.0 / bpm
        self.cursor_s: float = 0.0
        self._rng = random.Random(seed)

        scale_name = self._rng.choice(list(SCALES.keys()))
        self._scale = SCALES[scale_name]
        self._bass_root = self._scale[0] - 12
        self._beat_count = 0
        log.info(
            "AlgoGenerator ready: %s @ %.0f BPM, chunk=%.1f s",
            scale_name, bpm, chunk_seconds,
        )

    def _pick_melody_pitch(self) -> int:
        base = self._rng.choice(self._scale)
        octave_shift = self._rng.choice([0, 12])
        return base + octave_shift

    def _pick_velocity(self, is_downbeat: bool) -> int:
        base = 85 if is_downbeat else 70
        return min(127, max(30, base + self._rng.randint(-15, 15)))

    def next_chunk(self) -> list[NoteEvent]:
        notes: list[NoteEvent] = []
        t = self.cursor_s
        end = t + self.chunk_s

        while t < end:
            is_downbeat = self._beat_count % 4 == 0
            is_half = self._beat_count % 2 == 0

            if is_downbeat and self._rng.random() < 0.7:
                chord_pat = self._rng.choice(CHORD_PATTERNS)
                dur = self.beat_s * self._rng.choice([1.0, 1.5, 2.0])
                for idx in chord_pat:
                    p = self._scale[idx % len(self._scale)]
                    notes.append(NoteEvent(t, p, self._pick_velocity(True), dur))

                bass_pitch = self._bass_root + self._rng.choice([0, 7, 5])
                notes.append(NoteEvent(t, bass_pitch, self._pick_velocity(True), dur * 1.5))

            cell = self._rng.choice(RHYTHM_CELLS)
            sub_t = t
            for frac in cell:
                dur_s = frac * self.beat_s
                if sub_t + dur_s > end:
                    break
                if self._rng.random() < 0.85:
                    p = self._pick_melody_pitch()
                    v = self._pick_velocity(is_downbeat and sub_t == t)
                    notes.append(NoteEvent(sub_t, p, v, dur_s * 0.9))
                sub_t += dur_s

            if is_half and self._rng.random() < 0.3:
                p = self._bass_root + self._rng.choice([0, 3, 5, 7])
                notes.append(NoteEvent(t, p, self._pick_velocity(False), self.beat_s * 2))

            t += self.beat_s
            self._beat_count += 1

        self.cursor_s = end
        log.info("Generated %d notes for %.1f–%.1f s", len(notes), end - self.chunk_s, end)
        return notes
