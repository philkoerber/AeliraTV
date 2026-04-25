import { perfSnapshot } from "./perfStore.js";

/** Reset on scene mount before any tiles register. */
export function resetChunkMetrics(): void {
  perfSnapshot.loadedChunks = 0;
  perfSnapshot.lastChunkBuildMs = 0;
  perfSnapshot.lastChunkSwapMs = 0;
  perfSnapshot.chunkEvictionsTotal = 0;
  perfSnapshot.propsInstanceTotal = 0;
  perfSnapshot.propsLastMatrixBuildMs = 0;
  perfSnapshot.propsLastMergeMs = 0;
  perfSnapshot.propsMergeClampHits = 0;
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

/** Worst single-chunk CPU time spent rebuilding decor instance matrices (client). */
export function reportChunkPropsMatrixBuildMs(ms: number): void {
  if (ms > perfSnapshot.propsLastMatrixBuildMs) {
    perfSnapshot.propsLastMatrixBuildMs = ms;
  }
}

/** CPU time for merging decor matrices + uploading attributes for one asset pass. */
export function reportChunkPropsMerge(ms: number, _mergedCount?: number): void {
  if (ms > perfSnapshot.propsLastMergeMs) {
    perfSnapshot.propsLastMergeMs = ms;
  }
}

export function reportChunkPropsInstanceTotal(total: number): void {
  perfSnapshot.propsInstanceTotal = total;
}

export function reportChunkPropsMergeClampHits(delta: number): void {
  if (delta > 0) perfSnapshot.propsMergeClampHits += delta;
}
