/**
 * Deterministic hashes for a world seed (e.g. terrain UV jitter).
 * Same (worldSeed, …args) → same [0,1) on every client and run (no Math.random).
 */

export function scatterHash01(
  worldSeed: number,
  a: number,
  b: number,
  c = 0,
  d = 0,
): number {
  let h = (worldSeed | 0) >>> 0;
  h = Math.imul(h ^ ((a | 0) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((b | 0) >>> 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ ((c | 0) >>> 0), 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ ((d | 0) >>> 0), 0x165667b1) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) * (1 / 4294967296);
}
