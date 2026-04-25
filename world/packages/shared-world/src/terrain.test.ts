import { describe, expect, it } from "vitest";
import { heightAt, terrainSlopeMagnitude, terrainSlopeMagnitudeCoarse } from "./terrain.js";

/** Locks deterministic heightfield for default config + seed 1337 (multiplayer / foot placement). */
describe("heightAt regression", () => {
  const seed = 1337;
  const cfg = { seed };

  it("matches fixed samples", () => {
    expect(heightAt(0, 0, cfg)).toBeCloseTo(10.2722, 12);
    expect(heightAt(12.3, -7.9, cfg)).toBeCloseTo(11.006_628_924_847_43, 12);
    expect(heightAt(-55, 40, cfg)).toBeCloseTo(4.645_597_899_824_196, 12);
    expect(heightAt(200, -180, cfg)).toBeCloseTo(8.808_314_197_796_198, 12);
  });

  it("terrainSlopeMagnitude is finite and non-negative", () => {
    const s = terrainSlopeMagnitude(3, -4, cfg);
    expect(s).toBeCloseTo(0.130_605_115_771_224_05, 12);
    expect(Number.isFinite(s)).toBe(true);
  });

  it("terrainSlopeMagnitudeCoarse matches coarse eps semantics", () => {
    const s = terrainSlopeMagnitudeCoarse(3, -4, cfg);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s)).toBe(true);
  });
});
