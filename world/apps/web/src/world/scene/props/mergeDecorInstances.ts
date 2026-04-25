import type { DecorAssetId } from "@aeliratv/shared-world";
import type { ChunkPropsBuildsHandle } from "./ChunkPropsCoordinator.js";
import { CHUNK_VIEW_RADIUS } from "../terrain/ChunkTerrain.js";

export type MergedDecorForAsset = {
  count: number;
  /** Row-major 4×4, length `count * 16`. */
  matrix: Float32Array;
  /** Per-instance chunk ring visibility (1 = view window, ~0.22 = preload ring). */
  chunkFade: Float32Array;
};

/**
 * Stable merge order: sort chunk keys so identical `handle` yields identical buffers.
 */
export function mergeDecorInstancesForAsset(
  handle: ChunkPropsBuildsHandle,
  assetId: DecorAssetId,
): MergedDecorForAsset {
  const keys = Array.from(handle.byChunkKey.keys()).sort();
  let count = 0;
  for (const k of keys) {
    const b = handle.byChunkKey.get(k);
    if (!b) continue;
    const layer = b.layers.find((l) => l.assetId === assetId);
    if (layer) count += layer.count;
  }

  const matrix = new Float32Array(count * 16);
  const chunkFade = new Float32Array(count);
  let w = 0;

  for (const k of keys) {
    const b = handle.byChunkKey.get(k);
    if (!b) continue;
    const layer = b.layers.find((l) => l.assetId === assetId);
    if (!layer) continue;

    const baseFade = b.ring <= CHUNK_VIEW_RADIUS ? 1 : b.isPreloadRing ? 0.22 : 1;

    for (let i = 0; i < layer.count; i++) {
      matrix.set(layer.matrixArray.subarray(i * 16, i * 16 + 16), w * 16);
      chunkFade[w] = baseFade;
      w++;
    }
  }

  return { count, matrix, chunkFade };
}
