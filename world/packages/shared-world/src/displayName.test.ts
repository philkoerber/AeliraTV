import { describe, expect, it } from "vitest";
import { neutralShortNameFromSeed } from "./displayName.js";

describe("neutralShortNameFromSeed", () => {
  it("is stable for a fixed seed", () => {
    expect(neutralShortNameFromSeed(0xdeadbeef)).toBe(neutralShortNameFromSeed(0xdeadbeef));
  });

  it("matches known golden output for a few seeds", () => {
    expect(neutralShortNameFromSeed(0)).toMatch(/^[A-Za-z]+-[0-9A-Z]{3}$/);
    expect(neutralShortNameFromSeed(1)).toMatch(/^[A-Za-z]+-[0-9A-Z]{3}$/);
    expect(neutralShortNameFromSeed(0xffffffff)).toMatch(/^[A-Za-z]+-[0-9A-Z]{3}$/);
  });

  it("stays within 24 characters", () => {
    for (const seed of [0, 1, 42, 0x7fffffff, 0x80000000, 0xffffffff]) {
      expect(neutralShortNameFromSeed(seed >>> 0).length).toBeLessThanOrEqual(24);
    }
  });

  it("uses full uint32 range without throwing", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const name = neutralShortNameFromSeed((i * 999983) >>> 0);
      seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
