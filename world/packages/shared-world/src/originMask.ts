import type { TerrainConfig } from "./terrain.js";
import { heightAt } from "./terrain.js";

/** Authored-origin exception zone radius in world XZ (see world-deterministic-network rule). */
export const ORIGIN_RESERVE_RADIUS = 14;

export function isOriginReserve(x: number, z: number): boolean {
  return Math.hypot(x, z) < ORIGIN_RESERVE_RADIUS;
}

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Raw terrain height with a smooth "meadow bowl" at the origin: inside the reserve,
 * height blends from center value h(0,0) to the undisturbed field at the radius edge.
 */
export function surfaceHeightAt(x: number, z: number, cfg: TerrainConfig = {}): number {
  const base = heightAt(x, z, cfg);
  const center = heightAt(0, 0, cfg);
  const d = Math.hypot(x, z);
  const R = ORIGIN_RESERVE_RADIUS;
  if (d >= R) return base;
  const u = d / R;
  const edgeBlend = smoothstep01(u);
  return center + (base - center) * edgeBlend;
}
