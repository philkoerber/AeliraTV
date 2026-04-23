import { describe, expect, it } from "vitest";
import { heightAt, terrainSlopeMagnitude, terrainSlopeMagnitudeCoarse } from "./terrain.js";

/** Locks deterministic heightfield for default config + seed 1337 (multiplayer / foot placement). */
describe("heightAt regression", () => {
  const seed = 1337;
  const cfg = { seed };

  it("matches fixed samples", () => {
    expect(heightAt(0, 0, cfg)).toBeCloseTo(9.4514, 12);
    expect(heightAt(12.3, -7.9, cfg)).toBeCloseTo(9.903_236_127_208_444, 12);
    expect(heightAt(-55, 40, cfg)).toBeCloseTo(6.476_813_986_187_379, 12);
    expect(heightAt(200, -180, cfg)).toBeCloseTo(12.900_557_478_164_364, 12);
  });

  it("terrainSlopeMagnitude is finite and non-negative", () => {
    const s = terrainSlopeMagnitude(3, -4, cfg);
    expect(s).toBeCloseTo(0.045_018_281_890_670_11, 12);
    expect(Number.isFinite(s)).toBe(true);
  });

  it("terrainSlopeMagnitudeCoarse matches coarse eps semantics", () => {
    const s = terrainSlopeMagnitudeCoarse(3, -4, cfg);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s)).toBe(true);
  });
});
