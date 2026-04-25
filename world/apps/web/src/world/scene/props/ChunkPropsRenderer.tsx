import { useFBX, useTexture } from "@react-three/drei";
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import type { Room } from "colyseus.js";
import React, { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { reportChunkPropsInstanceTotal } from "../../perf/chunkMetricsBridge.js";
import { PROP_SETS, type PropSetId } from "./assetRegistry.js";
import type { ChunkPropsBuildsHandle } from "./ChunkPropsCoordinator.js";
import { DecorMergedInstancing } from "./DecorMergedInstancing.js";
import { bufferGeometryFromFbxRoot } from "./extractFbxGeometry.js";

function scaleGeometryInPlace(g: THREE.BufferGeometry, s: number): void {
  g.scale(s, s, s);
  g.computeBoundingSphere();
}

function useDecorTextures(): Record<string, THREE.Texture> {
  const gl = useThree((st: RootState) => st.gl);
  const urls = useMemo(() => {
    const u = new Set<string>();
    for (const spec of Object.values(PROP_SETS)) {
      for (const lod of spec.lods) {
        u.add(lod.textures.albedoUrl);
        if (lod.textures.normalUrl) u.add(lod.textures.normalUrl);
      }
    }
    return [...u].sort();
  }, []);

  const list = useTexture(urls) as THREE.Texture[];

  return useMemo(() => {
    const m: Record<string, THREE.Texture> = {};
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    urls.forEach((url, i) => {
      const t = list[i]!;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, maxAniso);
      t.colorSpace = url.includes("Normal") ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.needsUpdate = true;
      m[url] = t;
    });
    return m;
  }, [gl.capabilities, list, urls]);
}

export type ChunkPropsRendererProps = {
  buildsRef: React.MutableRefObject<ChunkPropsBuildsHandle>;
  room: Room;
  localSessionId: string;
};

const ASSET_ORDER: readonly PropSetId[] = ["meadow_plants", "bushes", "rocks"];

function ChunkPropsRendererInner({
  buildsRef,
  room,
  localSessionId,
}: ChunkPropsRendererProps): React.ReactElement {
  const textures = useDecorTextures();
  const meadow = useFBX(PROP_SETS.meadow_plants.lods[0]!.fbxUrl);
  const bushes = useFBX(PROP_SETS.bushes.lods[0]!.fbxUrl);
  const rocks = useFBX(PROP_SETS.rocks.lods[0]!.fbxUrl);

  const baseGeoms = useMemo(() => {
    const mg = (root: THREE.Object3D, scale: number) => {
      const g = bufferGeometryFromFbxRoot(root);
      scaleGeometryInPlace(g, scale);
      return g;
    };
    return {
      meadow_plants: mg(meadow, PROP_SETS.meadow_plants.worldGeometryScale),
      bushes: mg(bushes, PROP_SETS.bushes.worldGeometryScale),
      rocks: mg(rocks, PROP_SETS.rocks.worldGeometryScale),
    };
  }, [meadow, bushes, rocks]);

  useLayoutEffect(
    () => () => {
      baseGeoms.meadow_plants.dispose();
      baseGeoms.bushes.dispose();
      baseGeoms.rocks.dispose();
    },
    [baseGeoms],
  );

  const [renderVersion, setRenderVersion] = useState(0);
  const lastV = useRef(0);
  useFrame(() => {
    const v = buildsRef.current.version;
    if (v !== lastV.current) {
      lastV.current = v;
      setRenderVersion(v);
    }
  });

  useLayoutEffect(() => {
    let total = 0;
    for (const b of buildsRef.current.byChunkKey.values()) {
      for (const l of b.layers) total += l.count;
    }
    reportChunkPropsInstanceTotal(total);
  }, [renderVersion, buildsRef]);

  return (
    <group name="chunk-props-merged">
      {ASSET_ORDER.map((assetId) => (
        <DecorMergedInstancing
          key={assetId}
          assetId={assetId}
          baseGeometry={baseGeoms[assetId]}
          textures={textures}
          buildsRef={buildsRef}
          renderVersion={renderVersion}
          room={room}
          localSessionId={localSessionId}
        />
      ))}
    </group>
  );
}

export function ChunkPropsRenderer(props: ChunkPropsRendererProps): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <ChunkPropsRendererInner {...props} />
    </Suspense>
  );
}
