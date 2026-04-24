import { perfSnapshot } from "./perfStore.js";

/** Reset on scene mount before any tiles register. */
export function resetChunkMetrics(): void {
  perfSnapshot.loadedChunks = 0;
  perfSnapshot.lastChunkBuildMs = 0;
  perfSnapshot.lastChunkSwapMs = 0;
  perfSnapshot.chunkEvictionsTotal = 0;
}

export function reportChunkMetrics(patch: {
  loaded?: number;
  evictionsDelta?: number;
  lastBuildMs?: number;
  lastSwapMs?: number;
}): void {
  if (patch.loaded !== undefined) {
    perfSnapshot.loadedChunks = patch.loaded;
  }
  if (patch.evictionsDelta !== undefined && patch.evictionsDelta > 0) {
    perfSnapshot.chunkEvictionsTotal += patch.evictionsDelta;
  }
  if (patch.lastBuildMs !== undefined) {
    perfSnapshot.lastChunkBuildMs = patch.lastBuildMs;
  }
  if (patch.lastSwapMs !== undefined) {
    perfSnapshot.lastChunkSwapMs = patch.lastSwapMs;
  }
}

/** Per-tile geometry build cost (keep worst in window for HUD). */
export function reportChunkTileBuildMs(ms: number): void {
  if (ms > perfSnapshot.lastChunkBuildMs) {
    perfSnapshot.lastChunkBuildMs = ms;
  }
}
