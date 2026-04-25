import { isOriginReserve, surfaceHeightAt } from "./originMask.js";
import { normalizeSeed } from "./seed.js";
import { chunkOrigin, terrainSlopeMagnitudeCoarse, type TerrainConfig } from "./terrain.js";
import type { WorldContractFields } from "./worldContract.js";

export type BiomeId = "Meadow" | "Forest";

/** Must match client registry ids (world web) but lives here for determinism. */
export type DecorAssetId = "meadow_plants" | "bushes" | "rocks";

export type DecorInstance = {
  assetId: DecorAssetId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /**
   * Optional non-uniform scale (world units per axis). When set, client composes with
   * these instead of uniform `scale` (subtle rock silhouette break-up).
   */
  scaleAxes?: { x: number; y: number; z: number };
  /** Optional stable integer for future variant selection (submesh/material variants). */
  variant: number;
  /** 0..1 weights for biome blending (future). */
  biomeMix: { meadow: number; forest: number };
};

export type ChunkDecor = {
  cx: number;
  cz: number;
  instances: DecorInstance[];
};

export type DecorExcludeCircle = { x: number; z: number; r: number };

export type DecorOverrides = {
  /** Extra no-decor zones layered on top of origin reserve. */
  excludeCircles?: DecorExcludeCircle[];
  /** Forced placements layered on top of procedural output. */
  forceInstances?: Omit<DecorInstance, "biomeMix">[];
};

export type DecorGeneratorInput = {
  cx: number;
  cz: number;
  chunkSize: number;
  terrainCfg: TerrainConfig;
  /**
   * Separate from terrain seed: lets us rev decor without changing terrain.
   * Use contract `generatorBuild` + `rulesetVersion` as part of this number.
   */
  decorSeed: string | number;
  /** XOR-mixed into the decor PRNG; bump when decor rules change (contract `generatorBuild`). */
  generatorVersion?: number;
  overrides?: DecorOverrides;
};

/** Stable string for `decorSeed` from versioned world contract fields. */
export function decorSeedFromContract(
  fields: Pick<WorldContractFields, "worldSeed" | "rulesetVersion" | "generatorBuild">,
): string {
  return `${fields.worldSeed}|ruleset:${fields.rulesetVersion}|gen:${fields.generatorBuild}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Deterministic 32-bit hash to float in [0,1).
 * Keep all inputs integer-ish for stability across platforms.
 */
function hash01(a: number, b: number, c: number, d: number): number {
  // Mix similar to Murmur-ish integer avalanche.
  let h = 0x811c9dc5 ^ a;
  h = Math.imul(h, 0x01000193) ^ b;
  h = Math.imul(h, 0x01000193) ^ c;
  h = Math.imul(h, 0x01000193) ^ d;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  // >>>0 to uint, divide by 2^32.
  return (h >>> 0) / 4294967296;
}

/**
 * Very cheap value noise with bilinear interpolation (continuous across chunk seams).
 * Frequency is “cells per world unit”.
 */
function valueNoise01(x: number, z: number, seed: number, freq: number): number {
  const xf = x * freq;
  const zf = z * freq;
  const x0 = Math.floor(xf);
  const z0 = Math.floor(zf);
  const tx = xf - x0;
  const tz = zf - z0;
  const sx = smoothstep01(tx);
  const sz = smoothstep01(tz);
  const s = seed | 0;
  const v00 = hash01(x0, z0, s, 0x1234);
  const v10 = hash01(x0 + 1, z0, s, 0x1234);
  const v01 = hash01(x0, z0 + 1, s, 0x1234);
  const v11 = hash01(x0 + 1, z0 + 1, s, 0x1234);
  const a = lerp(v00, v10, sx);
  const b = lerp(v01, v11, sx);
  return lerp(a, b, sz);
}

/** Discrete biome label from the continuous biome field at world XZ. */
export function dominantBiomeAt(x: number, z: number, seedLike: string | number): BiomeId {
  const m = biomeMixAt(x, z, seedLike);
  return m.forest >= 0.5 ? "Forest" : "Meadow";
}

/** World-space biome weights (Forest vs Meadow) with domain warp for organic transitions. */
export function biomeMixAt(x: number, z: number, seedLike: string | number): {
  meadow: number;
  forest: number;
} {
  const seed = normalizeSeed(seedLike);
  // Domain warp to avoid straight biome borders.
  const warpFreq = 0.0085;
  const warpAmp = 28;
  const wx = (valueNoise01(x + 17.2, z - 9.3, seed ^ 0xa1b2c3d4, warpFreq) - 0.5) * 2 * warpAmp;
  const wz = (valueNoise01(x - 5.1, z + 22.7, seed ^ 0x51ed0702, warpFreq) - 0.5) * 2 * warpAmp;
  const bx = x + wx;
  const bz = z + wz;

  const biomeFreq = 0.0042;
  const n = valueNoise01(bx, bz, seed ^ 0x243f6a88, biomeFreq);
  // Soft band around threshold for blending.
  const forest = smoothstep01((n - 0.44) / 0.12);
  const meadow = 1 - forest;
  return { meadow, forest };
}

function isExcludedByOverrides(x: number, z: number, overrides?: DecorOverrides): boolean {
  if (!overrides?.excludeCircles?.length) return false;
  for (const c of overrides.excludeCircles) {
    if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
  }
  return false;
}

/**
 * Deterministic per-chunk decoration placements.
 * Design intent: cheap, seam-safe, and stable for a fixed `(decorSeed, cx, cz)`.
 */
export function generateChunkDecor(input: DecorGeneratorInput): ChunkDecor {
  const { cx, cz, chunkSize, terrainCfg, overrides } = input;
  let seed = normalizeSeed(input.decorSeed);
  if (input.generatorVersion !== undefined) {
    seed ^= Math.imul(input.generatorVersion | 0, 0x9e3779b1);
  }
  const { x0, z0 } = chunkOrigin(cx, cz, chunkSize);

  // Densities (instances per chunk, roughly) — tuned later by profiling.
  const baseMeadowPlants = 55;
  const baseBushes = 18;
  const baseRocks = 10;

  const instances: DecorInstance[] = [];

  /**
   * World-aligned scatter: each world cell (gx,gz) uses a hash independent of chunk id,
   * so density and jitter match across chunk boundaries (no seam doubling / phase shift).
   */
  function scatterSet(opts: {
    assetId: DecorAssetId;
    approxCount: number;
    cellJitter: number;
    maxSlope: number;
    scaleMin: number;
    scaleMax: number;
    biomeWeight: (mix: { meadow: number; forest: number }) => number;
    /** Per-asset decorrelation for hash01. */
    tag: number;
    /** World-space frequency for patch clustering (lower = larger clumps). */
    clusterFreq: number;
    /**
     * Sinusoidal macro stripes/bands in world XZ (mean multiplier 1).
     * Larger `macroK` = tighter bands; larger `macroAmp` = stronger empty vs dense contrast.
     */
    macroK: number;
    macroAmp: number;
  }): void {
    const nTarget = Math.max(0, opts.approxCount);
    if (nTarget <= 0) return;
    const cells = Math.max(2, Math.round(Math.sqrt(nTarget)));
    const wCell = chunkSize / cells;

    const gxLo = Math.floor(x0 / wCell);
    const gxHi = Math.ceil((x0 + chunkSize) / wCell);
    const gzLo = Math.floor(z0 / wCell);
    const gzHi = Math.ceil((z0 + chunkSize) / wCell);

    const cellKeys: Array<{ gx: number; gz: number }> = [];
    for (let gz = gzLo; gz < gzHi; gz++) {
      for (let gx = gxLo; gx < gxHi; gx++) {
        const xc = (gx + 0.5) * wCell;
        const zc = (gz + 0.5) * wCell;
        if (xc < x0 || xc >= x0 + chunkSize || zc < z0 || zc >= z0 + chunkSize) continue;
        cellKeys.push({ gx, gz });
      }
    }

    const cellCount = cellKeys.length;
    if (cellCount === 0) return;
    const p = nTarget / cellCount;
    /** Keeps expected count near `p` while biasing toward patches (gain averages to ~1). */
    const clusterMean = 0.42 + 1.18 / 3;
    const macroPhase = hash01(opts.tag & 0xffff, (seed >>> 0) & 0xffff, 0x5eed, 0x71) * Math.PI * 2;

    for (const { gx, gz } of cellKeys) {
      const jx = (hash01(gx, gz, seed ^ opts.tag, 0x2) - 0.5) * 2 * opts.cellJitter * wCell;
      const jz = (hash01(gx, gz, seed ^ opts.tag, 0x3) - 0.5) * 2 * opts.cellJitter * wCell;
      const xc = (gx + 0.5) * wCell;
      const zc = (gz + 0.5) * wCell;
      const x = xc + jx;
      const z = zc + jz;

      const patch = valueNoise01(x, z, seed ^ (opts.tag + 0x4a97), opts.clusterFreq);
      const k = opts.macroK;
      const theta = x * k + z * k * 1.6180339887 + macroPhase;
      const macroMul = 1 + opts.macroAmp * Math.sin(theta);
      const gain = (0.42 + 1.18 * patch * patch) * macroMul;
      const pEff = Math.min(1, (p * gain) / clusterMean);

      const r0 = hash01(gx, gz, seed ^ opts.tag, 0x1);
      if (r0 > pEff) continue;

      if (isOriginReserve(x, z)) continue;
      if (isExcludedByOverrides(x, z, overrides)) continue;

      const mix = biomeMixAt(x, z, seed);
      const w = clamp01(opts.biomeWeight(mix));
      if (w <= 0.001) continue;
      const rw = hash01(gx, gz, seed ^ opts.tag, 0x4);
      if (rw > w) continue;

      const slope = terrainSlopeMagnitudeCoarse(x, z, terrainCfg);
      if (slope > opts.maxSlope) continue;

      const y = surfaceHeightAt(x, z, terrainCfg);
      const yaw = (hash01(gx, gz, seed ^ opts.tag, 0x5) * 2 - 1) * Math.PI;
      const sc = lerp(opts.scaleMin, opts.scaleMax, hash01(gx, gz, seed ^ opts.tag, 0x6));
      const subtle = 0.945 + 0.11 * hash01(gx, gz, seed ^ opts.tag, 0x8c);
      const scale = sc * subtle;
      const variant = Math.floor(hash01(gx, gz, seed ^ opts.tag, 0x7) * 4);

      let scaleAxes: DecorInstance["scaleAxes"] | undefined;
      if (opts.assetId === "rocks") {
        const ax = 0.982 + 0.036 * hash01(gx, gz, seed ^ opts.tag, 0xb1);
        const ay = 0.978 + 0.044 * hash01(gx, gz, seed ^ opts.tag, 0xb2);
        const az = 0.982 + 0.036 * hash01(gx, gz, seed ^ opts.tag, 0xb3);
        scaleAxes = { x: scale * ax, y: scale * ay, z: scale * az };
      }

      instances.push({
        assetId: opts.assetId,
        x,
        y,
        z,
        yaw,
        scale,
        scaleAxes,
        variant,
        biomeMix: mix,
      });
    }
  }

  // Meadow: flowers/plants — floor in forest so chunks never go fully bare; still denser in meadow.
  scatterSet({
    assetId: "meadow_plants",
    approxCount: baseMeadowPlants,
    cellJitter: 0.46,
    maxSlope: 0.9,
    scaleMin: 0.75,
    scaleMax: 1.25,
    biomeWeight: (mix) => lerp(0.24, 1.0, mix.meadow),
    tag: 0x11aa_00dd,
    clusterFreq: 0.0092,
    macroK: 0.0195,
    macroAmp: 0.3,
  });

  // Bushes: both biomes but heavier in forest.
  scatterSet({
    assetId: "bushes",
    approxCount: baseBushes,
    cellJitter: 0.42,
    maxSlope: 0.85,
    scaleMin: 0.85,
    scaleMax: 1.35,
    biomeWeight: (mix) => lerp(0.35, 1.0, mix.forest),
    tag: 0x22bb_11ee,
    clusterFreq: 0.0076,
    macroK: 0.0172,
    macroAmp: 0.36,
  });

  // Rocks: low density, both biomes, slightly more in forest.
  scatterSet({
    assetId: "rocks",
    approxCount: baseRocks,
    cellJitter: 0.48,
    maxSlope: 1.25,
    scaleMin: 0.55,
    scaleMax: 1.65,
    biomeWeight: (mix) => lerp(0.55, 0.9, mix.forest),
    tag: 0x33cc_22ff,
    clusterFreq: 0.0068,
    macroK: 0.0148,
    macroAmp: 0.34,
  });

  // Forced instances last (overlay). Keep them deterministic by leaving their values unchanged.
  if (overrides?.forceInstances?.length) {
    for (const fi of overrides.forceInstances) {
      if (isOriginReserve(fi.x, fi.z)) continue;
      if (isExcludedByOverrides(fi.x, fi.z, overrides)) continue;
      instances.push({
        ...fi,
        biomeMix: biomeMixAt(fi.x, fi.z, seed),
      });
    }
  }

  // Stable ordering: sort by assetId then position.
  instances.sort((a, b) => {
    if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1;
    if (a.x !== b.x) return a.x - b.x;
    return a.z - b.z;
  });

  return { cx, cz, instances };
}

