import {
  chunkKeysInSquare,
  decorSeedFromContract,
  generateChunkDecor,
  parseChunkKey,
  worldXZToChunk,
  type DecorAssetId,
  type DecorOverrides,
  type TerrainConfig,
} from "@aeliratv/shared-world";
import { useFrame } from "@react-three/fiber";
import type { Room } from "colyseus.js";
import React, { useCallback, useRef } from "react";
import * as THREE from "three";
import { reportChunkPropsMatrixBuildMs } from "../../perf/chunkMetricsBridge.js";
import {
  CHUNK_PRELOAD_RADIUS,
  CHUNK_VIEW_RADIUS,
  EVICT_GRACE_MS,
  meshHeightAtXZ,
  type ChunkHeightField,
} from "../terrain/ChunkTerrain.js";

function stableOverridesKey(o: DecorOverrides | undefined): string {
  if (!o) return "0";
  try {
    return JSON.stringify({
      ex: o.excludeCircles ?? [],
      fi: o.forceInstances ?? [],
    });
  } catch {
    return "x";
  }
}

export type ChunkPropsLayerMatrices = {
  assetId: DecorAssetId;
  /** Row-major 4×4, length `count * 16`. */
  matrixArray: Float32Array;
  count: number;
};

export type ChunkPropsChunkBuild = {
  chunkKey: string;
  /** Chebyshev distance from window center in chunk units. */
  ring: number;
  /** True when chunk lies outside the view window but inside the preload square. */
  isPreloadRing: boolean;
  layers: ChunkPropsLayerMatrices[];
  /** Present while the chunk is retained after leaving the preload window (fade grace). */
  expiresAtMs: number | null;
};

export type ChunkPropsBuildsHandle = {
  /**
   * Increments when chunk membership changes, rings change, or any chunk's matrix buffers
   * are rebuilt.
   */
  version: number;
  byChunkKey: Map<string, ChunkPropsChunkBuild>;
};

type PropChunkItem = {
  key: string;
  ring: number;
  isPreloadRing: boolean;
  expiresAtMs: number | null;
  /** Contract + terrain height buffer identity used for last matrix build. */
  lastBuildKey: string;
  lastHeights: Float32Array | null;
  /** True once we have produced matrices for the current preload window slot. */
  hasMatrices: boolean;
};

export type ChunkPropsDecorContract = {
  worldSeed: string;
  rulesetVersion: number;
  generatorBuild: number;
};

type ChunkBuildInternal = Omit<ChunkPropsChunkBuild, "expiresAtMs"> & {
  layers: ChunkPropsLayerMatrices[];
};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _mat = new THREE.Matrix4();

const ASSET_ORDER: readonly DecorAssetId[] = [
  "bushes",
  "meadow_plants",
  "rocks",
];

function ringFlags(
  cx: number,
  cz: number,
  centerCx: number,
  centerCz: number,
): { ring: number; isPreloadRing: boolean } {
  const ring = Math.max(Math.abs(cx - centerCx), Math.abs(cz - centerCz));
  return {
    ring,
    isPreloadRing: ring > CHUNK_VIEW_RADIUS && ring <= CHUNK_PRELOAD_RADIUS,
  };
}

/**
 * Snap procedural decor to the rendered terrain height field when available;
 * falls back to analytical `instance.y` if the mesh field is missing (e.g. unloaded neighbor).
 */
function buildMatricesForChunk(
  cx: number,
  cz: number,
  chunkSize: number,
  terrainCfg: TerrainConfig,
  decorSeed: string,
  generatorBuild: number,
  fields: ReadonlyMap<string, ChunkHeightField>,
  overrides: DecorOverrides | undefined,
): { layers: ChunkPropsLayerMatrices[] } {
  const chunkDecor = generateChunkDecor({
    cx,
    cz,
    chunkSize,
    terrainCfg,
    decorSeed,
    generatorVersion: generatorBuild,
    overrides,
  });

  const counts = new Map<DecorAssetId, number>();
  for (const inst of chunkDecor.instances) {
    counts.set(inst.assetId, (counts.get(inst.assetId) ?? 0) + 1);
  }

  const cursors = new Map<DecorAssetId, number>();
  const buffers = new Map<DecorAssetId, Float32Array>();
  for (const [assetId, n] of counts) {
    buffers.set(assetId, new Float32Array(n * 16));
    cursors.set(assetId, 0);
  }

  for (const inst of chunkDecor.instances) {
    const yMesh = meshHeightAtXZ(inst.x, inst.z, fields, chunkSize);
    const yWorld = yMesh ?? inst.y;
    _pos.set(inst.x, yWorld, inst.z);
    _quat.setFromAxisAngle(_axisY, inst.yaw);
    if (inst.scaleAxes) {
      _scl.set(inst.scaleAxes.x, inst.scaleAxes.y, inst.scaleAxes.z);
    } else {
      _scl.set(inst.scale, inst.scale, inst.scale);
    }
    _mat.compose(_pos, _quat, _scl);
    const buf = buffers.get(inst.assetId)!;
    const o = cursors.get(inst.assetId)!;
    _mat.toArray(buf, o);
    cursors.set(inst.assetId, o + 16);
  }

  const layers: ChunkPropsLayerMatrices[] = [];
  for (const assetId of ASSET_ORDER) {
    const buf = buffers.get(assetId);
    const n = counts.get(assetId);
    if (!buf || !n) continue;
    layers.push({ assetId, matrixArray: buf, count: n });
  }

  return { layers };
}

function publishHandle(
  handleRef: React.MutableRefObject<ChunkPropsBuildsHandle>,
  items: Map<string, PropChunkItem>,
  builds: Map<string, ChunkBuildInternal>,
): void {
  const h = handleRef.current;
  const next = new Map<string, ChunkPropsChunkBuild>();
  for (const [key, item] of items) {
    const b = builds.get(key);
    if (!b) continue;
    next.set(key, {
      chunkKey: key,
      ring: b.ring,
      isPreloadRing: b.isPreloadRing,
      layers: b.layers,
      expiresAtMs: item.expiresAtMs,
    });
  }
  h.byChunkKey = next;
  h.version++;
}

/**
 * Tracks the same chunk square as terrain (`CHUNK_PRELOAD_RADIUS`), keeps builds through
 * `EVICT_GRACE_MS` after eviction, and fills instance matrices from height samples once each
 * chunk height field is registered.
 */
export function ChunkPropsCoordinator({
  room,
  localSessionId,
  terrainCfg,
  chunkSize,
  decorContract,
  heightFieldsRef,
  handleRef,
  decorOverridesRef,
}: {
  room: Room;
  localSessionId: string;
  terrainCfg: TerrainConfig;
  chunkSize: number;
  decorContract: ChunkPropsDecorContract;
  heightFieldsRef: React.MutableRefObject<Map<string, ChunkHeightField>>;
  handleRef: React.MutableRefObject<ChunkPropsBuildsHandle>;
  decorOverridesRef?: React.MutableRefObject<DecorOverrides | undefined>;
}): null {
  const centerRef = useRef<{ cx: number; cz: number }>({ cx: 0, cz: 0 });
  const itemsRef = useRef<Map<string, PropChunkItem>>(new Map());
  const buildsRef = useRef<Map<string, ChunkBuildInternal>>(new Map());
  const hasBootstrappedRef = useRef(false);
  const prevCenterKeyRef = useRef<string>("");

  const decorSeed = decorSeedFromContract(decorContract);
  const generatorBuild = decorContract.generatorBuild | 0;

  const ringForChunkKey = useCallback((chunkKey: string): { ring: number; isPreloadRing: boolean } => {
    const { cx, cz } = parseChunkKey(chunkKey);
    return ringFlags(cx, cz, centerRef.current.cx, centerRef.current.cz);
  }, []);

  const updateWindow = useCallback(
    (cx: number, cz: number) => {
      centerRef.current = { cx, cz };
      const wanted = chunkKeysInSquare(cx, cz, CHUNK_PRELOAD_RADIUS);
      const wantedSet = new Set(wanted);
      const isBootstrap = !hasBootstrappedRef.current;

      for (const k of wanted) {
        const { ring, isPreloadRing } = ringForChunkKey(k);
        const existing = itemsRef.current.get(k);
        if (existing) {
          existing.ring = ring;
          existing.isPreloadRing = isPreloadRing;
          existing.expiresAtMs = null;
        } else {
          itemsRef.current.set(k, {
            key: k,
            ring,
            isPreloadRing,
            expiresAtMs: null,
            lastBuildKey: "",
            lastHeights: null,
            hasMatrices: false,
          });
        }
      }

      if (isBootstrap) hasBootstrappedRef.current = true;

      const now = performance.now();
      for (const [k, item] of itemsRef.current) {
        if (wantedSet.has(k)) continue;
        if (item.expiresAtMs !== null) continue;
        item.expiresAtMs = now + EVICT_GRACE_MS;
      }
    },
    [ringForChunkKey],
  );

  useFrame(() => {
    let dirty = false;
    const p = room.state.players.get(localSessionId);
    if (!p) return;
    const { cx, cz } = worldXZToChunk(p.x, p.z, chunkSize);
    const centerKey = `${cx},${cz}`;
    if (centerKey !== prevCenterKeyRef.current) {
      prevCenterKeyRef.current = centerKey;
      updateWindow(cx, cz);
      dirty = true;
    }

    const fields = heightFieldsRef.current;

    for (const [key, item] of itemsRef.current) {
      const { cx: ck, cz: czK } = parseChunkKey(key);
      const rf = ringFlags(ck, czK, centerRef.current.cx, centerRef.current.cz);
      item.ring = rf.ring;
      item.isPreloadRing = rf.isPreloadRing;

      const hf = fields.get(key);
      if (!hf) {
        if (item.hasMatrices) {
          item.hasMatrices = false;
          item.lastHeights = null;
          item.lastBuildKey = "";
          buildsRef.current.delete(key);
          dirty = true;
        }
        continue;
      }

      const overrides = decorOverridesRef?.current;
      const buildKey = `${decorSeed}|gb:${generatorBuild}|${chunkSize}|${key}|ov:${stableOverridesKey(overrides)}`;
      const heightsChanged = item.lastHeights !== hf.heights;
      const contractChanged = item.lastBuildKey !== buildKey;
      const needBuild = !item.hasMatrices || heightsChanged || contractChanged;

      const prevBuild = buildsRef.current.get(key);

      if (needBuild) {
        const t0 = performance.now();
        const { layers } = buildMatricesForChunk(
          ck,
          czK,
          chunkSize,
          terrainCfg,
          decorSeed,
          generatorBuild,
          fields,
          overrides,
        );
        reportChunkPropsMatrixBuildMs(performance.now() - t0);
        buildsRef.current.set(key, {
          chunkKey: key,
          ring: rf.ring,
          isPreloadRing: rf.isPreloadRing,
          layers,
        });
        item.lastBuildKey = buildKey;
        item.lastHeights = hf.heights;
        item.hasMatrices = true;
        dirty = true;
      } else if (prevBuild) {
        if (prevBuild.ring !== rf.ring || prevBuild.isPreloadRing !== rf.isPreloadRing) {
          prevBuild.ring = rf.ring;
          prevBuild.isPreloadRing = rf.isPreloadRing;
          dirty = true;
        }
      }
    }

    const now = performance.now();
    for (const [k, item] of itemsRef.current) {
      if (item.expiresAtMs !== null && item.expiresAtMs <= now) {
        itemsRef.current.delete(k);
        buildsRef.current.delete(k);
        dirty = true;
      }
    }

    if (dirty) {
      publishHandle(handleRef, itemsRef.current, buildsRef.current);
    }
  });

  return null;
}
