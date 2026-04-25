import type { DecorAssetId } from "@aeliratv/shared-world";
import { useFrame } from "@react-three/fiber";
import type { Room } from "colyseus.js";
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  reportChunkPropsMerge,
  reportChunkPropsMergeClampHits,
} from "../../perf/chunkMetricsBridge.js";
import { PROP_SETS, type PropSetId, propSetLodSpec } from "./assetRegistry.js";
import { createDecorDualMapInstancedMaterial } from "./decorInstancedMaterial.js";
import { mergeDecorInstancesForAsset } from "./mergeDecorInstances.js";
import type { ChunkPropsBuildsHandle } from "./ChunkPropsCoordinator.js";

const MAX_BY_ASSET: Record<PropSetId, number> = {
  meadow_plants: 8000,
  bushes: 4500,
  rocks: 2500,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type Props = {
  assetId: PropSetId;
  /** Shared (scaled) base geometry — cloned internally so each instancer owns buffers. */
  baseGeometry: THREE.BufferGeometry;
  textures: Record<string, THREE.Texture>;
  buildsRef: React.MutableRefObject<ChunkPropsBuildsHandle>;
  /** Bumped when `buildsRef.current.version` changes. */
  renderVersion: number;
  room: Room;
  localSessionId: string;
};

export function DecorMergedInstancing({
  assetId,
  baseGeometry,
  textures,
  buildsRef,
  renderVersion,
  room,
  localSessionId,
}: Props): React.ReactElement | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const spec = PROP_SETS[assetId];
  const max = MAX_BY_ASSET[assetId];

  const geometry = useMemo(() => {
    const g = baseGeometry.clone();
    g.setAttribute("aLodBlend", new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
    g.setAttribute("aChunkFade", new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
    return g;
  }, [baseGeometry, max]);

  const material = useMemo(() => {
    const farLod = propSetLodSpec(assetId, "far");
    const nearLod = propSetLodSpec(assetId, "near");
    const farMap = textures[farLod.textures.albedoUrl];
    const nearMap = textures[nearLod.textures.albedoUrl];
    if (!farMap || !nearMap) return null;
    const farNormal = farLod.textures.normalUrl
      ? textures[farLod.textures.normalUrl]
      : undefined;
    return createDecorDualMapInstancedMaterial({
      farMap,
      nearMap,
      farNormalMap: farNormal,
      roughness: farLod.material.roughness,
      metalness: farLod.material.metalness,
      transparent: farLod.material.transparent,
      alphaTest: farLod.material.alphaTest,
      side:
        farLod.material.side === "double" ? THREE.DoubleSide : THREE.FrontSide,
    });
  }, [assetId, textures]);

  useLayoutEffect(() => {
    if (!material) return;
    const t0 = performance.now();
    const merged = mergeDecorInstancesForAsset(buildsRef.current, assetId as DecorAssetId);
    const mesh = meshRef.current;
    const lodA = geometry.getAttribute("aLodBlend") as THREE.InstancedBufferAttribute;
    const fadeA = geometry.getAttribute("aChunkFade") as THREE.InstancedBufferAttribute;
    if (!mesh || !lodA || !fadeA) return;

    const writeCount = Math.min(merged.count, max);
    if (merged.count > max) {
      reportChunkPropsMergeClampHits(merged.count - max);
      // eslint-disable-next-line no-console
      console.warn(
        `[DecorMergedInstancing] ${assetId}: instance count ${merged.count} exceeds max ${max}; clamping`,
      );
    }

    mesh.count = writeCount;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.array.fill(0);
    mesh.instanceMatrix.array.set(merged.matrix.subarray(0, writeCount * 16));
    mesh.instanceMatrix.needsUpdate = true;

    fadeA.array.fill(0);
    fadeA.array.set(merged.chunkFade.subarray(0, writeCount));
    fadeA.needsUpdate = true;

    lodA.array.fill(0);
    lodA.needsUpdate = true;

    mesh.visible = mesh.count > 0;
    mesh.castShadow = spec.category === "rocks";
    mesh.receiveShadow = true;

    const dt = performance.now() - t0;
    reportChunkPropsMerge(dt);
  }, [assetId, buildsRef, geometry, material, max, renderVersion, spec.category]);

  useLayoutEffect(
    () => () => {
      geometry.dispose();
      if (material) {
        material.map = null;
        material.normalMap = null;
        material.dispose();
      }
    },
    [geometry, material],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || mesh.count === 0) return;
    const p = room.state.players.get(localSessionId);
    if (!p) return;

    const lodA = geometry.getAttribute("aLodBlend") as THREE.InstancedBufferAttribute;
    const fadeA = geometry.getAttribute("aChunkFade") as THREE.InstancedBufferAttribute;
    const m = mesh.instanceMatrix.array as Float32Array;
    const px = typeof p.x === "number" && Number.isFinite(p.x) ? p.x : 0;
    const pz = typeof p.z === "number" && Number.isFinite(p.z) ? p.z : 0;

    const inner = 3.2;
    const outer = 46;

    for (let i = 0; i < mesh.count; i++) {
      const x = m[i * 16 + 12]!;
      const z = m[i * 16 + 14]!;
      const base = fadeA.array[i] ?? 1;
      const d = Math.hypot(x - px, z - pz);
      const lb = base < 0.6 ? 0 : 1 - smoothstep(inner, outer, d);
      lodA.array[i] = lb;
    }
    lodA.needsUpdate = true;
  });

  if (!material) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, max]}
      frustumCulled={false}
    />
  );
}
