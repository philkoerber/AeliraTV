import { chunkKey } from "./terrain.js";

export type ChunkIndex = { cx: number; cz: number };

/** World XZ to integer chunk indices (floor division; consistent with `chunkOrigin`). */
export function worldXZToChunk(x: number, z: number, chunkSize: number): ChunkIndex {
  const S = chunkSize;
  return {
    cx: Math.floor(x / S),
    cz: Math.floor(z / S)
  };
}

/** All chunk keys in a square window inclusive, sorted by (cx, cz) for stable comparisons. */
export function chunkKeysInSquare(cxCenter: number, czCenter: number, radius: number): string[] {
  const r = Math.max(0, Math.floor(radius));
  const keys: string[] = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      keys.push(chunkKey(cxCenter + dx, czCenter + dz));
    }
  }
  keys.sort((a, b) => {
    const pa = parseChunkKey(a);
    const pb = parseChunkKey(b);
    return pa.cx - pb.cx || pa.cz - pb.cz;
  });
  return keys;
}

export function parseChunkKey(key: string): ChunkIndex {
  const i = key.indexOf(",");
  if (i <= 0 || i === key.length - 1) {
    throw new Error(`Invalid chunkKey: ${key}`);
  }
  const cx = Number(key.slice(0, i));
  const cz = Number(key.slice(i + 1));
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    throw new Error(`Invalid chunkKey: ${key}`);
  }
  return { cx, cz };
}
