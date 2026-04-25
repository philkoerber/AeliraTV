import { normalizeSeed } from "./seed.js";

export type TerrainConfig = {
  seed?: string | number;
  /**
   * Legacy overall detail amplitude (smooth rolling hills).
   * Prefer `detailAmplitude` when tuning macro separately.
   */
  amplitude?: number;
  frequency?: number;
  /** Amplitude of the smooth high-frequency stack (default: same as `amplitude` or 2.2). */
  detailAmplitude?: number;
  /** Low-frequency smooth continent lift. */
  macroAmplitude?: number;
  macroFrequency?: number;
  /** How much ridged noise is mixed into the macro layer (0 = none). */
  ridgeWeight?: number;
  /** Subtracts smooth valleys proportional to `valleyDepth` (world units). */
  valleyDepth?: number;
  /** Spatial scale of valley envelope (default tied to `frequency`). */
  valleyFrequency?: number;
  /** Added after combining layers; keeps typical walk heights positive. */
  verticalOffset?: number;
};

export function heightAt(x: number, z: number, cfg: TerrainConfig = {}): number {
  const seed = normalizeSeed(cfg.seed);
  // Slightly lower default frequency reduces micro-noise; compensate with macro amplitude.
  const frequency = cfg.frequency ?? 0.05;
  const detailAmp = cfg.detailAmplitude ?? cfg.amplitude ?? 2.0;

  // Domain rotation keeps features from lining up with world XZ travel axes.
  const c = 0.918_052_533_487_42;
  const s = 0.396_424_653_758_465;
  const xr = x * c - z * s;
  const zr = x * s + z * c;

  // Gradient (Perlin-style) noise — meso detail.
  const n1 = smoothGradientNoise2D(xr * frequency, zr * frequency, seed);
  const n2 = smoothGradientNoise2D(xr * frequency * 2, zr * frequency * 2, seed ^ 0x9e3779b9);
  const n3 = smoothGradientNoise2D(xr * frequency * 4, zr * frequency * 4, seed ^ 0x85ebca6b);
  // Reduce the highest octave a bit to avoid "sparkle" while keeping shape.
  const detail = (n1 * 0.68 + n2 * 0.26 + n3 * 0.06) * detailAmp;

  const macroFreq = cfg.macroFrequency ?? frequency * 0.175;
  const macroAmp = cfg.macroAmplitude ?? 22;
  const m1 = smoothGradientNoise2D(xr * macroFreq, zr * macroFreq, seed ^ 0x243f6a88);
  const m2 = smoothGradientNoise2D(xr * macroFreq * 2.05, zr * macroFreq * 2.05, seed ^ 0x243f6a89);
  const macroSmooth = (m1 * 0.62 + m2 * 0.38) * macroAmp;

  const ridgeW = cfg.ridgeWeight ?? 0.52;
  const ridgeN = smoothGradientNoise2D(
    xr * macroFreq * 1.88,
    zr * macroFreq * 1.88,
    seed ^ 0xb7e15162,
  );
  const ridged = (1 - Math.abs(ridgeN)) * 2 - 1;
  const macro = macroSmooth + ridged * macroAmp * 0.38 * ridgeW;

  const valleyFreq = cfg.valleyFrequency ?? frequency * 0.085;
  const valleyN = smoothGradientNoise2D(xr * valleyFreq, zr * valleyFreq, seed ^ 0x51ed0702);
  const valleyEnvelope = valleyN * 0.5 + 0.5;
  const valleyCarve = (cfg.valleyDepth ?? 2.5) * valleyEnvelope * valleyEnvelope;

  const lift = cfg.verticalOffset ?? 6.55;
  return lift + detail + macro - valleyCarve;
}

/** Approximate |∇h| in XZ; useful for biome/scatter gating (deterministic for fixed eps). */
export function terrainSlopeMagnitude(x: number, z: number, cfg: TerrainConfig = {}, eps = 0.32): number {
  const hx =
    (heightAt(x + eps, z, cfg) - heightAt(x - eps, z, cfg)) / (2 * eps);
  const hz =
    (heightAt(x, z + eps, cfg) - heightAt(x, z - eps, cfg)) / (2 * eps);
  return Math.hypot(hx, hz);
}

/** Same as `terrainSlopeMagnitude` but larger `eps` — less micro-variation (fewer scatter pops, same 4 samples). */
export function terrainSlopeMagnitudeCoarse(
  x: number,
  z: number,
  cfg: TerrainConfig = {},
  eps = 0.58,
): number {
  return terrainSlopeMagnitude(x, z, cfg, eps);
}

export type ChunkCoord = { cx: number; cz: number };

export function chunkOrigin(cx: number, cz: number, chunkSize: number): { x0: number; z0: number } {
  return { x0: cx * chunkSize, z0: cz * chunkSize };
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Pseudorandom gradient on integer lattice (Perlin-style). */
function grad2(ix: number, iz: number, seed: number): { gx: number; gz: number } {
  const h = valueAtGrid(ix, iz, seed ^ 0xa53e7c41);
  const ang = h * Math.PI * 2;
  return { gx: Math.cos(ang), gz: Math.sin(ang) };
}

function smoothGradientNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;

  const g00 = grad2(x0, z0, seed);
  const g10 = grad2(x0 + 1, z0, seed);
  const g01 = grad2(x0, z0 + 1, seed);
  const g11 = grad2(x0 + 1, z0 + 1, seed);

  const n00 = g00.gx * xf + g00.gz * zf;
  const n10 = g10.gx * (xf - 1) + g10.gz * zf;
  const n01 = g01.gx * xf + g01.gz * (zf - 1);
  const n11 = g11.gx * (xf - 1) + g11.gz * (zf - 1);

  const u = smootherstep(xf);
  const v = smootherstep(zf);
  const xLow = lerp(n00, n10, u);
  const xHigh = lerp(n01, n11, u);
  return lerp(xLow, xHigh, v);
}

function valueAtGrid(x: number, z: number, seed: number): number {
  let h = seed | 0;
  h ^= Math.imul(x | 0, 0x27d4eb2d);
  h ^= Math.imul(z | 0, 0x165667b1);
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h, 0x85ebca6b) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 0xc2b2ae35) | 0;
  h = (h ^ (h >>> 16)) | 0;
  const u = h >>> 0;
  return (u & 0xffffff) / 0x1000000;
}

/** C² at t∈{0,1} — Perlin-style interpolation. */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
