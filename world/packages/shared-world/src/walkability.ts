import type { TerrainConfig } from "./terrain.js";
import { terrainSlopeMagnitude } from "./terrain.js";

export const WalkClass = {
  Open: 0,
  Steep: 1,
  Blocked: 2
} as const;

export type WalkClassId = (typeof WalkClass)[keyof typeof WalkClass];

const SLOPE_STEEP = 1.15;
const SLOPE_BLOCKED = 2.35;

/** Deterministic coarse walk class from raw terrain slope (same samples as scatter gating). */
export function walkClassAt(x: number, z: number, cfg: TerrainConfig = {}): WalkClassId {
  const s = terrainSlopeMagnitude(x, z, cfg);
  if (s >= SLOPE_BLOCKED) return WalkClass.Blocked;
  if (s >= SLOPE_STEEP) return WalkClass.Steep;
  return WalkClass.Open;
}
