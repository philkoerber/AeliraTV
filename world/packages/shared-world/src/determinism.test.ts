import { describe, expect, it } from "vitest";
import { surfaceHeightAt } from "./originMask.js";
import { chunkKey, chunkOrigin, heightAt } from "./terrain.js";
import { terrainConfigFromContract } from "./worldContract.js";
import { WalkClass, walkClassAt } from "./walkability.js";

describe("terrainConfigFromContract", () => {
  it("is stable for a fixed seed string", () => {
    const cfg = terrainConfigFromContract({ worldSeed: "w:test-room" });
    expect(heightAt(1.25, -3.5, cfg)).toBeCloseTo(8.029_021_981_850_43, 10);
  });
});

describe("surfaceHeightAt origin bowl", () => {
  const cfg = terrainConfigFromContract({ worldSeed: "w:origin-bowl" });

  it("matches raw height at origin", () => {
    expect(surfaceHeightAt(0, 0, cfg)).toBeCloseTo(heightAt(0, 0, cfg), 12);
  });

  it("matches raw height outside reserve", () => {
    const x = 25;
    const z = 0;
    expect(surfaceHeightAt(x, z, cfg)).toBeCloseTo(heightAt(x, z, cfg), 10);
  });

  it("is inside reserve between center and raw edge", () => {
    const x = 7;
    const z = 3;
    const raw = heightAt(x, z, cfg);
    const surf = surfaceHeightAt(x, z, cfg);
    const c = heightAt(0, 0, cfg);
    const lo = Math.min(c, raw);
    const hi = Math.max(c, raw);
    expect(surf).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(surf).toBeLessThanOrEqual(hi + 1e-9);
  });
});

describe("chunkOrigin / chunkKey", () => {
  it("round-trips chunk indices", () => {
    const cs = 64;
    for (const cx of [-2, 0, 3]) {
      for (const cz of [1, -5]) {
        const { x0, z0 } = chunkOrigin(cx, cz, cs);
        expect(Math.round(x0 / cs)).toBe(cx);
        expect(Math.round(z0 / cs)).toBe(cz);
        expect(chunkKey(cx, cz)).toBe(`${cx},${cz}`);
      }
    }
  });
});

/** No cliff at integer chunk grid lines: world-space height is continuous. */
describe("chunk seam continuity (raw heightAt)", () => {
  const cfg = terrainConfigFromContract({ worldSeed: "w:seam" });
  const chunkSize = 64;
  const eps = 0.04;
  const maxJump = 1.8;

  it("across x = k * chunkSize", () => {
    for (let k = -2; k <= 2; k++) {
      const x = k * chunkSize;
      for (const z of [-30.2, 0.5, 17.8]) {
        const a = heightAt(x - eps, z, cfg);
        const b = heightAt(x + eps, z, cfg);
        expect(Math.abs(a - b)).toBeLessThan(maxJump);
      }
    }
  });

  it("across z = k * chunkSize", () => {
    for (let k = -2; k <= 2; k++) {
      const z = k * chunkSize;
      for (const x of [-11, 22.4]) {
        const a = heightAt(x, z - eps, cfg);
        const b = heightAt(x, z + eps, cfg);
        expect(Math.abs(a - b)).toBeLessThan(maxJump);
      }
    }
  });
});

describe("surfaceHeightAt seam continuity", () => {
  const cfg = terrainConfigFromContract({ worldSeed: "w:seam-surf" });
  const chunkSize = 64;
  const eps = 0.04;
  const maxJump = 2.2;

  it("bounded delta across chunk lines", () => {
    const x = 2 * chunkSize;
    const z = 9.1;
    const a = surfaceHeightAt(x - eps, z, cfg);
    const b = surfaceHeightAt(x + eps, z, cfg);
    expect(Math.abs(a - b)).toBeLessThan(maxJump);
  });
});

describe("walkClassAt", () => {
  const cfg = terrainConfigFromContract({ worldSeed: "w:walk" });

  it("returns known enum values", () => {
    const c = walkClassAt(0, 0, cfg);
    expect([WalkClass.Open, WalkClass.Steep, WalkClass.Blocked]).toContain(c);
  });
});
