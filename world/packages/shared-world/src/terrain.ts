import { normalizeSeed } from "./seed.js";

export type TerrainConfig = {
  seed?: string | number;
  amplitude?: number;
  frequency?: number;
};

export function heightAt(x: number, z: number, cfg: TerrainConfig = {}): number {
  const seed = normalizeSeed(cfg.seed);
  const amplitude = cfg.amplitude ?? 2.2;
  const frequency = cfg.frequency ?? 0.06;

  // A tiny layered value-noise-ish function; good enough for an MVP.
  const n1 = smoothValueNoise2D(x * frequency, z * frequency, seed);
  const n2 = smoothValueNoise2D(x * frequency * 2, z * frequency * 2, seed ^ 0x9e3779b9);
  const n3 = smoothValueNoise2D(x * frequency * 4, z * frequency * 4, seed ^ 0x85ebca6b);

  const n = n1 * 0.65 + n2 * 0.25 + n3 * 0.1;
  return n * amplitude;
}

export type ChunkCoord = { cx: number; cz: number };

export function chunkOrigin(cx: number, cz: number, chunkSize: number): { x0: number; z0: number } {
  return { x0: cx * chunkSize, z0: cz * chunkSize };
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function smoothValueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;

  const v00 = valueAtGrid(x0, z0, seed);
  const v10 = valueAtGrid(x0 + 1, z0, seed);
  const v01 = valueAtGrid(x0, z0 + 1, seed);
  const v11 = valueAtGrid(x0 + 1, z0 + 1, seed);

  const u = smoothstep(xf);
  const v = smoothstep(zf);

  const x1 = lerp(v00, v10, u);
  const x2 = lerp(v01, v11, u);
  return lerp(x1, x2, v) * 2 - 1; // map [0,1] -> [-1,1]
}

function valueAtGrid(x: number, z: number, seed: number): number {
  // integer hash -> [0,1)
  let h = seed | 0;
  h ^= Math.imul(x | 0, 0x27d4eb2d);
  h ^= Math.imul(z | 0, 0x165667b1);
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h, 0x85ebca6b) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 0xc2b2ae35) | 0;
  h = (h ^ (h >>> 16)) | 0;
  // convert to uint
  const u = h >>> 0;
  return (u & 0xffffff) / 0x1000000;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

