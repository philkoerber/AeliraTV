import {
  chunkKeysInSquare,
  chunkOrigin,
  parseChunkKey,
  surfaceHeightAt,
  worldXZToChunk,
  type TerrainConfig,
} from "@aeliratv/shared-world";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import type { Room } from "colyseus.js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import type { ChunkInterestPayload } from "../../net.js";
import {
  reportChunkMetrics,
  reportChunkTileBuildMs,
} from "../../perf/chunkMetricsBridge.js";

/** Square window half-size in chunk units: 1 => 3×3, 2 => 5×5 (server clamps interest to 0..2). */
export const CHUNK_VIEW_RADIUS = 2;

/** Extra ring(s) of chunks to keep loaded to avoid visible pop-in. */
export const CHUNK_PRELOAD_RADIUS = CHUNK_VIEW_RADIUS + 1;

/** Used by `ChunkPropsCoordinator` for deferred prop teardown when chunks leave the window. */
export const EVICT_GRACE_MS = 12_000;

const SEGMENTS_PER_CHUNK = 14;

export type ChunkHeightField = {
  cx: number;
  cz: number;
  chunkSize: number;
  seg: number;
  x0: number;
  z0: number;
  heights: Float32Array; // (seg+1)*(seg+1), row-major by (iz*(seg+1)+ix)
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Height of the *rendered* terrain mesh at (x,z), using the same sampled grid + triangle split.
 * Returns null if the relevant chunk isn't available in the current window.
 */
export function meshHeightAtXZ(
  x: number,
  z: number,
  fields: ReadonlyMap<string, ChunkHeightField>,
  chunkSize: number,
): number | null {
  const { cx, cz } = worldXZToChunk(x, z, chunkSize);
  const key = `${cx},${cz}`;
  const f = fields.get(key);
  if (!f) return null;

  const seg = f.seg;
  const w = seg + 1;
  const cell = chunkSize / seg;

  // Local coords in chunk.
  const lx = x - f.x0;
  const lz = z - f.z0;
  const fx = lx / cell;
  const fz = lz / cell;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  ix = Math.max(0, Math.min(seg - 1, ix));
  iz = Math.max(0, Math.min(seg - 1, iz));

  const u = clamp01(fx - ix);
  const v = clamp01(fz - iz);

  const i00 = iz * w + ix;
  const i10 = i00 + 1;
  const i01 = i00 + w;
  const i11 = i01 + 1;
  const h00 = f.heights[i00] ?? 0;
  const h10 = f.heights[i10] ?? 0;
  const h01 = f.heights[i01] ?? 0;
  const h11 = f.heights[i11] ?? 0;

  // Match index order in buildChunkSurfaceGeometry: indices.push(a, c, b, b, c, d)
  // where a=(0,0), b=(1,0), c=(0,1), d=(1,1).
  if (u + v <= 1) {
    // Triangle (a,c,b): barycentric for point (u,v) in a->b (u), a->c (v)
    return h00 + (h10 - h00) * u + (h01 - h00) * v;
  }
  // Triangle (b,c,d)
  const alpha = 1 - u;
  const beta = u + v - 1;
  return h10 + (h01 - h10) * alpha + (h11 - h10) * beta;
}

/**
 * Horizontal distance from the chunk-window center to the outer boundary of loaded
 * terrain along ±X/±Z, for a square of (2*radius+1) chunks each `chunkSize` wide.
 * Outer face of the farthest ring: (radius + 0.5) * chunkSize.
 */
function terrainWindowEdgeDistanceXZ(
  chunkSize: number,
  radius: number,
): number {
  return (radius + 0.5) * chunkSize;
}

/**
 * Linear fog tuned so most of the loaded patch stays clear while the void past tile
 * edges blends into `FOG_COLOR` (see plan: edge-biased fog).
 */
export function linearFogNearFarForChunkWindow(
  chunkSize: number,
  radius: number,
): { near: number; far: number } {
  const edge = terrainWindowEdgeDistanceXZ(chunkSize, radius);
  return {
    near: Math.max(20, edge * 0.76),
    far: Math.min(205, Math.max(edge * 1.12, edge + chunkSize * 0.55)),
  };
}

type TerrainGrassMaterialOpts = { vertexColors: boolean };

function createTerrainGrassMaterial(
  opts: TerrainGrassMaterialOpts,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    // White so world-space albedo (custom map sampling) matches PNG brightness; tint via vertexColors only.
    color: "#ffffff",
    metalness: 0.04,
    roughness: 0.93,
    vertexColors: opts.vertexColors,
    flatShading: false,
  });
}

type GroundTexLayer = {
  map: THREE.Texture;
};

type TerrainGroundBlendOpts = {
  base: GroundTexLayer;
  macro: GroundTexLayer;
  /**
   * World meters per texture repeat (bigger => less repetition).
   * These are *world-space* UVs, so they are stable across chunks.
   */
  baseTileMeters: number;
  macroTileMeters: number;
  /** Blend strength in [0..1]. */
  macroStrength: number;
  /** Noise cell size in world meters (bigger => slower variation). */
  lfoCellMeters: number;
};

function applyTerrainGroundBlend(
  material: THREE.MeshStandardMaterial,
  opts: TerrainGroundBlendOpts,
): void {
  // IMPORTANT: chunk terrain geometry has no UVs.
  // So we must NOT rely on MeshStandardMaterial's built-in `map`/`normalMap` sampling.
  // Everything is sampled from world-space XZ in the shader below.
  material.map = null;
  material.normalMap = null;

  material.customProgramCacheKey = () =>
    `terrainGroundBlend/v1:${opts.baseTileMeters}:${opts.macroTileMeters}:${opts.macroStrength}:${opts.lfoCellMeters}`;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseMap = { value: opts.base.map };
    shader.uniforms.uMacroMap = { value: opts.macro.map };
    shader.uniforms.uBaseTileMeters = { value: opts.baseTileMeters };
    shader.uniforms.uMacroTileMeters = { value: opts.macroTileMeters };
    shader.uniforms.uMacroStrength = { value: opts.macroStrength };
    shader.uniforms.uLfoCellMeters = { value: opts.lfoCellMeters };

    // Inject world position varying.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // Deterministic value noise (cheap) in world space.
    const noiseFns = `
uniform sampler2D uBaseMap;
uniform sampler2D uMacroMap;
uniform float uBaseTileMeters;
uniform float uMacroTileMeters;
uniform float uMacroStrength;
uniform float uLfoCellMeters;
varying vec3 vWorldPos;

float hash21(vec2 p) {
  // 2D -> 1D hash, deterministic.
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Smooth interpolation.
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
${noiseFns}`,
    );

    // Override base color using a guaranteed shader hook.
    // `map_fragment` isn't always present / isn't always safe to patch, but `color_fragment` is.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
#include <color_fragment>
// --- terrain ground blend (world-space) ---
vec2 worldXZ = vWorldPos.xz;
vec2 uvBase = worldXZ / max(0.0001, uBaseTileMeters);
vec2 uvMacro = worldXZ / max(0.0001, uMacroTileMeters);

// NOTE: keep sampling simple; mapTexelToLinear is not always available in this shader.
vec4 baseC = texture2D(uBaseMap, uvBase);
vec4 macroC = texture2D(uMacroMap, uvMacro);

// Low-frequency deterministic “LFO” signal in world space.
float n = valueNoise2D(worldXZ / max(0.0001, uLfoCellMeters));
float t = clamp(uMacroStrength * n, 0.0, 1.0);

diffuseColor *= baseC;
diffuseColor.rgb = mix(diffuseColor.rgb, macroC.rgb, t);
// --- end terrain ground blend ---
`,
    );
  };

  material.needsUpdate = true;
}

/** Deterministic [0,1) from integer grid — stable across runs (visual only). */
function hash01FromGrid(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) * 2 ** -32;
}

function writeGrassVertexColor(
  x: number,
  z: number,
  out: Float32Array,
  o: number,
): void {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const t = hash01FromGrid(ix, iz);
  const t2 = hash01FromGrid(ix + 101, iz - 67);
  const t3 = hash01FromGrid(ix - 53, iz + 89);
  // Stay near 1 so `diffuseColor *= vColor` in StandardMaterial does not crush albedo (was ~0.1 RGB).
  out[o] = 0.92 + 0.07 * t;
  out[o + 1] = 0.93 + 0.06 * t2;
  out[o + 2] = 0.9 + 0.08 * t3;
}

function buildChunkSurfaceGeometry(
  cx: number,
  cz: number,
  chunkSize: number,
  seg: number,
  cfg: TerrainConfig,
): {
  geom: THREE.BufferGeometry;
  heights: Float32Array;
  x0: number;
  z0: number;
} {
  const { x0, z0 } = chunkOrigin(cx, cz, chunkSize);
  const S = chunkSize;
  const positions = new Float32Array((seg + 1) * (seg + 1) * 3);
  const heights = new Float32Array((seg + 1) * (seg + 1));
  const indices: number[] = [];
  let pi = 0;
  let hi = 0;
  for (let iz = 0; iz <= seg; iz++) {
    for (let ix = 0; ix <= seg; ix++) {
      const u = ix / seg;
      const v = iz / seg;
      const x = x0 + u * S;
      const z = z0 + v * S;
      const y = surfaceHeightAt(x, z, cfg);
      positions[pi++] = x;
      positions[pi++] = y;
      positions[pi++] = z;
      heights[hi++] = y;
    }
  }
  const colors = new Float32Array((seg + 1) * (seg + 1) * 3);
  let ci = 0;
  for (let iz = 0; iz <= seg; iz++) {
    for (let ix = 0; ix <= seg; ix++) {
      const u = ix / seg;
      const v = iz / seg;
      const x = x0 + u * S;
      const z = z0 + v * S;
      writeGrassVertexColor(x, z, colors, ci);
      ci += 3;
    }
  }
  const W = seg + 1;
  for (let iz = 0; iz < seg; iz++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iz * W + ix;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return { geom: g, heights, x0, z0 };
}

function ChunkTile({
  chunkKeyProp,
  chunkSize,
  cfg,
  segments,
  baseMaterial,
  onHeightField,
}: {
  chunkKeyProp: string;
  chunkSize: number;
  cfg: TerrainConfig;
  segments: number;
  baseMaterial: THREE.MeshStandardMaterial;
  onHeightField: (chunkKey: string, field: ChunkHeightField | null) => void;
}): React.ReactElement {
  const { cx, cz } = parseChunkKey(chunkKeyProp);

  const built = useMemo(() => {
    const t0 = performance.now();
    const g = buildChunkSurfaceGeometry(cx, cz, chunkSize, segments, cfg);
    reportChunkTileBuildMs(performance.now() - t0);
    return g;
  }, [cx, cz, chunkSize, segments, cfg]);

  const material = useMemo(() => {
    const m = baseMaterial.clone();
    // Ensure shader patch is preserved across clones.
    // `Material.clone()` does not reliably preserve custom `onBeforeCompile`.
    m.customProgramCacheKey = baseMaterial.customProgramCacheKey;
    m.onBeforeCompile = baseMaterial.onBeforeCompile;
    return m;
  }, [baseMaterial]);

  useEffect(
    () => () => {
      built.geom.dispose();
    },
    [built],
  );

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  useEffect(() => {
    onHeightField(chunkKeyProp, {
      cx,
      cz,
      chunkSize,
      seg: segments,
      x0: built.x0,
      z0: built.z0,
      heights: built.heights,
    });
    return () => onHeightField(chunkKeyProp, null);
  }, [
    built.heights,
    built.x0,
    built.z0,
    chunkKeyProp,
    chunkSize,
    cx,
    cz,
    onHeightField,
    segments,
  ]);

  return (
    <mesh geometry={built.geom} material={material} castShadow receiveShadow />
  );
}

export function ChunkTerrainCoordinator({
  room,
  localSessionId,
  terrainCfg,
  chunkSize,
  onHeightField,
}: {
  room: Room;
  localSessionId: string;
  terrainCfg: TerrainConfig;
  chunkSize: number;
  onHeightField: (chunkKey: string, field: ChunkHeightField | null) => void;
}): React.ReactElement {
  const baseTex = useTexture("/ground/GroundGrass256.png");
  const macroTex = useTexture("/ground/GroundDirt256.png");
  const { gl } = useThree();

  useMemo(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const t of [baseTex, macroTex]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(16, maxAniso);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
    }
    baseTex.colorSpace = THREE.SRGBColorSpace;
    macroTex.colorSpace = THREE.SRGBColorSpace;
    return null;
  }, [baseTex, gl.capabilities, macroTex]);

  const terrainMaterial = useMemo(
    () => {
      const m = createTerrainGrassMaterial({ vertexColors: true });
      applyTerrainGroundBlend(m, {
        base: { map: baseTex },
        macro: { map: macroTex },
        // Smaller meters/repeat => more texels per meter (less blocky at 256² sources).
        baseTileMeters: 52,
        macroTileMeters: 92,
        macroStrength: 0.45,
        lfoCellMeters: 48,
      });
      return m;
    },
    [baseTex, macroTex],
  );
  useEffect(
    () => () => {
      terrainMaterial.dispose();
    },
    [terrainMaterial],
  );

  const loadedKeysRef = useRef<Set<string>>(new Set());
  const [rev, bump] = useState(0);

  const updateWindow = useCallback(
    (cx: number, cz: number) => {
      const wanted = chunkKeysInSquare(cx, cz, CHUNK_PRELOAD_RADIUS);
      const wantedSet = new Set(wanted);
      const keys = loadedKeysRef.current;

      for (const k of wanted) keys.add(k);
      const toRemove: string[] = [];
      for (const k of keys) {
        if (!wantedSet.has(k)) toRemove.push(k);
      }
      for (const k of toRemove) keys.delete(k);

      reportChunkMetrics({
        loaded: wanted.length,
        evictionsDelta: 0,
        lastSwapMs: 0,
      });

      room.send("chunkInterest", {
        radius: CHUNK_VIEW_RADIUS,
      } as ChunkInterestPayload);
      bump((v) => v + 1);
    },
    [room],
  );

  const prevCenterRef = useRef<string>("");
  useFrame(() => {
    const p = room.state.players.get(localSessionId);
    if (!p) return;
    const { cx, cz } = worldXZToChunk(p.x, p.z, chunkSize);
    const centerKey = `${cx},${cz}`;
    if (centerKey === prevCenterRef.current) return;
    prevCenterRef.current = centerKey;
    const t0 = performance.now();
    updateWindow(cx, cz);
    reportChunkMetrics({
      loaded: chunkKeysInSquare(cx, cz, CHUNK_PRELOAD_RADIUS).length,
      evictionsDelta: 0,
      lastSwapMs: performance.now() - t0,
    });
  });

  const chunkKeys = useMemo(
    () => Array.from(loadedKeysRef.current),
    [rev],
  );

  return (
    <group>
      {chunkKeys.map((key) => (
        <ChunkTile
          key={key}
          chunkKeyProp={key}
          chunkSize={chunkSize}
          cfg={terrainCfg}
          segments={SEGMENTS_PER_CHUNK}
          baseMaterial={terrainMaterial}
          onHeightField={onHeightField}
        />
      ))}
    </group>
  );
}
