import type { BudgetStatus } from "./budgets.js";

/** Mutable snapshot; writers use refs / useFrame; readers use throttled React or tooling. */
export type PerfSnapshot = {
  lastFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  frameSamples: number;
  fpsInstant: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  drawStatus: BudgetStatus;
  frameStatus: BudgetStatus;
  memoryStatus: BudgetStatus;
  /** Tiled chunk window (client); server tracks `chunkInterest` messages. */
  loadedChunks: number;
  lastChunkBuildMs: number;
  lastChunkSwapMs: number;
  chunkEvictionsTotal: number;
  /** Colyseus (filled by net probe) */
  statePatchesTotal: number;
  statePatchesPerSec: number;
  outgoingSendsTotal: number;
  outgoingSendsPerSec: number;
  outgoingBytesTotal: number;
  outgoingBytesPerSec: number;
  incomingWsBytesTotal: number;
  incomingWsBytesPerSec: number;
  incomingWsHooked: boolean;
};

export const perfSnapshot: PerfSnapshot = {
  lastFrameMs: 0,
  p50FrameMs: Number.NaN,
  p95FrameMs: Number.NaN,
  frameSamples: 0,
  fpsInstant: 0,
  drawCalls: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  geometries: 0,
  textures: 0,
  drawStatus: "ok",
  frameStatus: "ok",
  memoryStatus: "ok",
  loadedChunks: 0,
  lastChunkBuildMs: 0,
  lastChunkSwapMs: 0,
  chunkEvictionsTotal: 0,
  statePatchesTotal: 0,
  statePatchesPerSec: 0,
  outgoingSendsTotal: 0,
  outgoingSendsPerSec: 0,
  outgoingBytesTotal: 0,
  outgoingBytesPerSec: 0,
  incomingWsBytesTotal: 0,
  incomingWsBytesPerSec: 0,
  incomingWsHooked: false
};
