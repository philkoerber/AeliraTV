import { describe, expect, it } from "vitest";
import { chunkKeysInSquare, parseChunkKey, worldXZToChunk } from "./chunkCoords.js";
import { chunkKey, chunkOrigin } from "./terrain.js";

describe("worldXZToChunk", () => {
  it("maps origin into chunk 0,0 for positive size", () => {
    expect(worldXZToChunk(0, 0, 64)).toEqual({ cx: 0, cz: 0 });
  });

  it("maps negative coords with floor semantics", () => {
    expect(worldXZToChunk(-1, -1, 64)).toEqual({ cx: -1, cz: -1 });
    expect(worldXZToChunk(-64, 0, 64)).toEqual({ cx: -1, cz: 0 });
  });

  it("aligns with chunkOrigin round-trip for chunk center", () => {
    const S = 64;
    const { cx, cz } = worldXZToChunk(100, -30, S);
    const { x0, z0 } = chunkOrigin(cx, cz, S);
    expect(100).toBeGreaterThanOrEqual(x0);
    expect(100).toBeLessThan(x0 + S);
    expect(-30).toBeGreaterThanOrEqual(z0);
    expect(-30).toBeLessThan(z0 + S);
  });
});

describe("chunkKeysInSquare", () => {
  it("returns (2r+1)^2 keys for radius 1", () => {
    const keys = chunkKeysInSquare(0, 0, 1);
    expect(keys.length).toBe(9);
  });

  it("returns 25 keys for radius 2", () => {
    expect(chunkKeysInSquare(0, 0, 2).length).toBe(25);
  });

  it("is sorted lexicographically by (cx,cz)", () => {
    const keys = chunkKeysInSquare(0, 0, 1);
    const parsed = keys.map(parseChunkKey);
    for (let i = 1; i < parsed.length; i++) {
      const a = parsed[i - 1]!;
      const b = parsed[i]!;
      expect(a.cx < b.cx || (a.cx === b.cx && a.cz <= b.cz)).toBe(true);
    }
  });
});

describe("parseChunkKey", () => {
  it("round-trips chunkKey", () => {
    expect(parseChunkKey(chunkKey(-2, 5))).toEqual({ cx: -2, cz: 5 });
  });
});
