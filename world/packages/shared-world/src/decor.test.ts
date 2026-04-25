import { describe, expect, it } from "vitest";
import { biomeMixAt, decorSeedFromContract, dominantBiomeAt, generateChunkDecor } from "./decor.js";
import { terrainConfigFromContract } from "./worldContract.js";

describe("biome field", () => {
  it("mix weights sum to 1", () => {
    for (const [x, z] of [
      [0, 0],
      [120.5, -33.2],
      [-80, 900],
    ] as const) {
      const m = biomeMixAt(x, z, "w:biome-sum");
      expect(m.meadow + m.forest).toBeCloseTo(1, 6);
      expect(m.meadow).toBeGreaterThanOrEqual(0);
      expect(m.meadow).toBeLessThanOrEqual(1);
      expect(m.forest).toBeGreaterThanOrEqual(0);
      expect(m.forest).toBeLessThanOrEqual(1);
    }
  });

  it("dominantBiomeAt matches forest / meadow split", () => {
    expect(["Forest", "Meadow"]).toContain(dominantBiomeAt(0, 0, "w:dom"));
  });
});

describe("generateChunkDecor", () => {
  it("is deterministic for fixed inputs", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-det" });
    const a = generateChunkDecor({
      cx: 2,
      cz: -1,
      chunkSize: 64,
      terrainCfg,
      decorSeed: "w:decor-det|build:1",
    });
    const b = generateChunkDecor({
      cx: 2,
      cz: -1,
      chunkSize: 64,
      terrainCfg,
      decorSeed: "w:decor-det|build:1",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes when chunk coords change", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-delta" });
    const a = generateChunkDecor({
      cx: 0,
      cz: 0,
      chunkSize: 64,
      terrainCfg,
      decorSeed: "w:decor-delta|build:1",
    });
    const b = generateChunkDecor({
      cx: 1,
      cz: 0,
      chunkSize: 64,
      terrainCfg,
      decorSeed: "w:decor-delta|build:1",
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("never places instances inside origin reserve", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-origin" });
    const out = generateChunkDecor({
      cx: 0,
      cz: 0,
      chunkSize: 64,
      terrainCfg,
      decorSeed: "w:decor-origin|build:1",
    });
    for (const i of out.instances) {
      expect(Math.hypot(i.x, i.z)).toBeGreaterThanOrEqual(14);
    }
  });

  it("changes when generatorVersion changes", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-genver" });
    const base = { cx: -2, cz: 3, chunkSize: 64, terrainCfg, decorSeed: "w:decor-genver|build:1" };
    const a = generateChunkDecor({ ...base, generatorVersion: 1 });
    const b = generateChunkDecor({ ...base, generatorVersion: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("uses world-aligned cells so adjacent chunks do not duplicate world positions", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-seam" });
    const decorSeed = "w:decor-seam|build:1";
    const seen = new Set<string>();
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const out = generateChunkDecor({ cx, cz, chunkSize: 64, terrainCfg, decorSeed });
        for (const i of out.instances) {
          const key = `${i.assetId}:${i.x.toFixed(5)}:${i.z.toFixed(5)}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it("keeps meadow flowers present across chunks (biome floor + macro layer)", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-flowers" });
    const decorSeed = decorSeedFromContract({
      worldSeed: "w:decor-flowers",
      rulesetVersion: 1,
      generatorBuild: 1,
    });
    let minMeadow = Infinity;
    let sumMeadow = 0;
    const n = 11 * 11;
    for (let cx = -5; cx <= 5; cx++) {
      for (let cz = -5; cz <= 5; cz++) {
        const out = generateChunkDecor({
          cx,
          cz,
          chunkSize: 64,
          terrainCfg,
          decorSeed,
          generatorVersion: 1,
        });
        let m = 0;
        for (const i of out.instances) if (i.assetId === "meadow_plants") m++;
        minMeadow = Math.min(minMeadow, m);
        sumMeadow += m;
      }
    }
    expect(minMeadow).toBeGreaterThan(0);
    expect(sumMeadow / n).toBeGreaterThan(12);
  });

  it("accepts decorSeedFromContract for stable versioning", () => {
    const terrainCfg = terrainConfigFromContract({ worldSeed: "w:decor-contract" });
    const decorSeed = decorSeedFromContract({
      worldSeed: "w:decor-contract",
      rulesetVersion: 1,
      generatorBuild: 7,
    });
    const once = generateChunkDecor({
      cx: 0,
      cz: 0,
      chunkSize: 64,
      terrainCfg,
      decorSeed,
    });
    const twice = generateChunkDecor({
      cx: 0,
      cz: 0,
      chunkSize: 64,
      terrainCfg,
      decorSeed,
    });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

