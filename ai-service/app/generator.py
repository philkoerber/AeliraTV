"""
Wraps the Anticipatory Music Transformer to yield note events in small chunks.

The public interface is `NoteEvent` (a dataclass) and `MidiGenerator` which
exposes an iterator that yields lists of NoteEvents, each list covering
approximately `chunk_seconds` of new music.
"""

from __future__ import annotations

import logging
import time as _time
from dataclasses import dataclass

import torch
from transformers import AutoModelForCausalLM

from anticipation.sample import generate
from anticipation.config import TIME_RESOLUTION
from anticipation.vocab import TIME_OFFSET, DUR_OFFSET, NOTE_OFFSET
from anticipation import ops

log = logging.getLogger(__name__)

MODEL_ID = "stanford-crfm/music-medium-800k"


@dataclass(slots=True)
class NoteEvent:
    onset_s: float
    pitch: int
    velocity: int
    duration_s: float


def _events_to_notes(events: list[int]) -> list[NoteEvent]:
    """Convert the flat anticipation token list into NoteEvent objects.

    All notes are mapped to piano regardless of the instrument the model chose,
    since sfizz only has the Salamander Grand Piano loaded.
    """
    notes: list[NoteEvent] = []
    n_triplets = len(events) // 3
    for time_tok, dur_tok, note_tok in zip(
        events[0::3], events[1::3], events[2::3]
    ):
        time_ticks = time_tok - TIME_OFFSET
        dur_ticks = dur_tok - DUR_OFFSET
        raw_note = note_tok - NOTE_OFFSET
        pitch = raw_note % 128
        if pitch < 21 or pitch > 108:
            continue  # outside piano range
        notes.append(
            NoteEvent(
                onset_s=time_ticks / TIME_RESOLUTION,
                pitch=pitch,
                velocity=80,
                duration_s=max(dur_ticks / TIME_RESOLUTION, 0.05),
            )
        )
    log.info("Converted %d triplets → %d piano-range notes", n_triplets, len(notes))
    return notes


class MidiGenerator:
    """
    Streaming wrapper around the AMT `generate()` function.

    Generates music in `chunk_seconds`-wide windows, feeding the tail of the
    previous generation as history/context for the next call.  This produces
    an endless stream of NoteEvents.
    """

    def __init__(
        self,
        chunk_seconds: float = 3.0,
        overlap_seconds: float = 2.0,
        top_p: float = 0.98,
    ):
        self.chunk_s = chunk_seconds
        self.overlap_s = overlap_seconds
        self.top_p = top_p
        self.cursor_s: float = 0.0  # absolute time we've generated through
        self._history: list[int] = []

        log.info("Loading model %s …", MODEL_ID)
        self.model = AutoModelForCausalLM.from_pretrained(MODEL_ID)
        self.model.eval()
        log.info("Model loaded (CPU).")

    @torch.inference_mode()
    def next_chunk(self) -> list[NoteEvent]:
        """Generate the next chunk and return its NoteEvents.

        The anticipation library's add_token() already relativizes time
        internally, so we pass absolute times and history directly.
        We just need to keep the history short enough for the 1024-token
        context window (~341 events = 1023 tokens).
        """
        start = self.cursor_s
        end = start + self.chunk_s

        history = self._history
        max_history_tokens = 900
        if len(history) > max_history_tokens:
            history = history[-max_history_tokens:]
            history = history[len(history) % 3:]

        log.info(
            "Generating %.1f → %.1f s (history tokens: %d)",
            start, end, len(history),
        )
        t0 = _time.monotonic()
        events = generate(
            self.model,
            start_time=start,
            end_time=end,
            inputs=history,
            top_p=self.top_p,
        )
        elapsed = _time.monotonic() - t0
        log.info("generate() took %.1f s for %.1f s of music", elapsed, self.chunk_s)

        notes = _events_to_notes(events)

        keep_from = max(0, end - self.overlap_s)
        self._history = ops.clip(events, keep_from, end, clip_duration=False)

        self.cursor_s = end
        return notes
