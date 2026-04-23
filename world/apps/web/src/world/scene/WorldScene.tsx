import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { heightAt } from "@aeliratv/shared-world";
import { PlayerAvatar } from "./PlayerAvatar";
import { DevWorldCapture } from "./DevWorldCapture";
import { RainEffect } from "./RainEffect";
import { patchGroundMeshStandardMaterial } from "./groundShaderPatch.js";
import { scatterHash01 } from "./worldScatterHash.js";

/** World-space offset from focus → sun (directional light + sky must agree). */
const SUN_OFFSET = new THREE.Vector3(62, 92, 28);
const SKY_SUN_POSITION = SUN_OFFSET.clone().normalize();

/** Clear / fog tint — terrain fog + backdrop gradient horizon should match this. */
const SCENE_FOG_COLOR_HEX = "#c2d2ea";
/** Scene fog on meshes only. Sky/backdrop stay unfogged (small sky at origin + moving camera = outside box = flat clear color). */
const SCENE_FOG_EXP2_DENSITY = 0.024;

/** FBM on a torus (ax, az in radians) — periodic so texture tiles without UV seam lines. */
function terrainFbmTorus(ax: number, az: number): number {
  let amp = 0.52;
  let freq = 1.05;
  let sum = 0;
  for (let o = 0; o < 5; o++) {
    sum +=
      amp *
      Math.sin(ax * freq + o * 1.73) *
      Math.cos(az * freq * 1.02 + o * 0.91);
    freq *= 2.08;
    amp *= 0.5;
  }
  return sum * 0.5 + 0.5;
}

/** Organic grass/soil albedo — toroidal domain so `RepeatWrapping` has no 0/1 edge mismatch. */
function createGrassGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("WorldScene: canvas 2d context unavailable");
  }

  const img = ctx.createImageData(size, size);
  const d = img.data;
  const warp = 0.38;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const ax = ((px + 0.5) / size) * Math.PI * 2;
      const az = ((py + 0.5) / size) * Math.PI * 2;
      const axw =
        ax +
        warp *
          (Math.sin(az * 5.1 + 0.3) * Math.cos(ax * 5.2 + 1.1) * 0.5 +
            Math.sin(ax * 2.7 + az * 1.4) * 0.12);
      const azw =
        az +
        warp *
          (Math.sin(ax * 5.0 + 2.1) * Math.cos(az * 4.9 + 0.8) * 0.5 +
            Math.sin(az * 2.6 + ax * 1.9) * 0.12);
      const n = terrainFbmTorus(axw * 2.2, azw * 2.2);
      const fine = terrainFbmTorus(axw * 14 + 2.1, azw * 14 + 0.7);
      const patch = terrainFbmTorus(axw * 4.5 + 11, azw * 4.5 + 3.2);
      const micro = terrainFbmTorus(axw * 38 + 5.2, azw * 38 + 1.7);

      const soil = Math.max(0, patch - 0.62) * 2.4;
      const warmth = (n * 0.45 + fine * 0.35) * 22;
      const r = Math.floor(
        THREE.MathUtils.clamp(
          62 + n * 44 + fine * 14 + soil * 78 + micro * 7 + warmth,
          0,
          255,
        ),
      );
      const g = Math.floor(
        THREE.MathUtils.clamp(
          108 + n * 58 + fine * 26 + soil * 42 + micro * 9 + warmth * 0.35,
          0,
          255,
        ),
      );
      const b = Math.floor(
        THREE.MathUtils.clamp(
          48 + n * 30 + fine * 11 + soil * 22 + micro * 5,
          0,
          255,
        ),
      );
      const i = (py * size + px) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Neutral multiply layer — toroidal so high-frequency repeats don’t draw seam lines. */
function createGroundDetailTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("WorldScene: canvas 2d context unavailable");
  }
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const ax = ((px + 0.5) / size) * Math.PI * 2;
      const az = ((py + 0.5) / size) * Math.PI * 2;
      const n =
        terrainFbmTorus(ax * 2.2 + 1.7, az * 2.2 + 0.4) * 0.62 +
        terrainFbmTorus(ax * 5.1 + 4.2, az * 5.1 + 3.1) * 0.38;
      const lum = 0.52 + n * 0.42;
      const v = Math.floor(THREE.MathUtils.clamp(lum * 255, 0, 255));
      const i = (py * size + px) * 4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Vertical gradient for an inverted sky sphere — reads as depth without an HDR asset. */
function createSkyGradientTexture(): THREE.CanvasTexture {
  const w = 4;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("WorldScene: sky canvas 2d context unavailable");
  }
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#5aa8ff");
  grd.addColorStop(0.42, "#9ec8ff");
  grd.addColorStop(0.58, "#d8e8ff");
  grd.addColorStop(0.68, "#e0e8f4");
  grd.addColorStop(0.82, SCENE_FOG_COLOR_HEX);
  grd.addColorStop(1, SCENE_FOG_COLOR_HEX);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Large inner sphere that follows the camera — fills view when terrain fog hides the horizon. */
function SkyBackdrop() {
  const meshRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => createSkyGradientTexture(), []);
  useFrame(({ camera }) => {
    const m = meshRef.current;
    if (m) {
      m.position.copy(camera.position);
    }
  });
  useEffect(() => {
    return () => {
      tex.dispose();
    };
  }, [tex]);
  return (
    <mesh ref={meshRef} renderOrder={-80} frustumCulled={false}>
      <sphereGeometry args={[1600, 20, 14]} />
      <meshBasicMaterial
        map={tex}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={true}
        fog={false}
      />
    </mesh>
  );
}

type Room = any;

type Props = {
  room: Room;
  displayName: string;
  /** Enables `window.__AELIRA_DEV__` and dev-only capture helpers (gated in `Game`). */
  devAccessEnabled?: boolean;
};

const TERRAIN_SEED = 7741;
/** Central difference step for ∂h/∂x,z — smaller than noise wavelength avoids stair-step normals. */
const HEIGHT_NORMAL_EPS = 0.22;

/** Normals from ∂h/∂x, ∂h/∂z at world (x,z); `worldX/Z` map local plane coords (after rotateX) to world XZ. */
function applyHeightfieldVertexNormalsFromWorldXZ(
  geo: THREE.BufferGeometry,
  worldX: (lx: number, lz: number) => number,
  worldZ: (lx: number, lz: number) => number,
  seed: number,
): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  const scratch = new THREE.Vector3();
  const cfg = { seed };
  const eps = HEIGHT_NORMAL_EPS;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const wx = worldX(lx, lz);
    const wz = worldZ(lx, lz);
    const hx =
      (heightAt(wx + eps, wz, cfg) - heightAt(wx - eps, wz, cfg)) / (2 * eps);
    const hz =
      (heightAt(wx, wz + eps, cfg) - heightAt(wx, wz - eps, cfg)) / (2 * eps);
    scratch.set(-hx, 1, -hz).normalize();
    nrm.setXYZ(i, scratch.x, scratch.y, scratch.z);
  }
  nrm.needsUpdate = true;
}

/** Normals from ∂h/∂x, ∂h/∂z at world (x,z); square plane with `minEdge*` at min XZ corner (legacy layout). */
function applyHeightfieldVertexNormalsPlane(
  geo: THREE.BufferGeometry,
  minEdgeX: number,
  minEdgeZ: number,
  span: number,
  seed: number,
): void {
  const half = span * 0.5;
  applyHeightfieldVertexNormalsFromWorldXZ(
    geo,
    (lx, lz) => minEdgeX + lx + half,
    (lx, lz) => minEdgeZ + lz + half,
    seed,
  );
}

function assignTerrainUVs(
  geo: THREE.BufferGeometry,
  pos: THREE.BufferAttribute,
  seed: number,
  metersPerTextureRepeat: number,
  worldX: (lx: number, lz: number) => number,
  worldZ: (lx: number, lz: number) => number,
): void {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const wx = worldX(lx, lz);
    const wz = worldZ(lx, lz);
    const wxi = Math.floor(wx * 512);
    const wzi = Math.floor(wz * 512);
    const ju = (scatterHash01(seed, wxi, 11, wzi) - 0.5) * 0.05;
    const jv = (scatterHash01(seed, wxi, 17, wzi, 1) - 0.5) * 0.05;
    uv.setXY(
      i,
      wx / metersPerTextureRepeat + ju,
      wz / metersPerTextureRepeat + jv,
    );
  }
  uv.needsUpdate = true;
}

/**
 * `PlaneGeometry` uses the same diagonal in every quad; with smooth shading that aligns
 * micro-geometry errors and reads as a world-axis checker. Flip every other quad’s diagonal.
 */
function applyStaggeredPlaneTriangulation(
  geo: THREE.BufferGeometry,
  widthSegments: number,
  heightSegments: number,
): void {
  const gridX = widthSegments;
  const gridY = heightSegments;
  const gridX1 = gridX + 1;
  const idx: number[] = [];
  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const a = ix + gridX1 * iy;
      const b = ix + gridX1 * (iy + 1);
      const c = ix + 1 + gridX1 * (iy + 1);
      const d = ix + 1 + gridX1 * iy;
      if ((ix + iy) % 2 === 0) {
        idx.push(a, b, d, b, c, d);
      } else {
        idx.push(a, b, c, a, c, d);
      }
    }
  }
  geo.setIndex(idx);
}

type SimPlayer = {
  id: string;
  name: string;
  server: THREE.Vector3;
  view: THREE.Vector3;
  yaw: number;
  lastPos: THREE.Vector3;
  lastT: number;
  speed: number;
  moveAmount: React.MutableRefObject<number>;
  viewRef: React.MutableRefObject<THREE.Vector3>;
  serverYawRef: React.MutableRefObject<number>;
};

function SunLights() {
  const { camera } = useThree();
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight(0xfff2dc, 1.34);
    l.castShadow = true;
    l.shadow.mapSize.set(512, 512);
    l.shadow.camera.near = 0.4;
    l.shadow.camera.far = 320;
    const span = 68;
    l.shadow.camera.left = -span;
    l.shadow.camera.right = span;
    l.shadow.camera.top = span;
    l.shadow.camera.bottom = -span;
    l.shadow.bias = -0.00035;
    l.shadow.normalBias = 0.038;
    return l;
  }, []);

  useFrame(() => {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const gy = heightAt(cx, cz, { seed: TERRAIN_SEED }) + 1.35;
    sun.target.position.set(cx, gy, cz);
    sun.position.copy(sun.target.position).add(SUN_OFFSET);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  });

  useEffect(() => {
    return () => {
      sun.dispose();
    };
  }, [sun]);

  return (
    <>
      <hemisphereLight args={[0xffefd8, 0x4a6a38, 0.76]} />
      <primitive object={sun} />
      <primitive object={sun.target} />
    </>
  );
}

function PointerLock({ yawRef }: { yawRef: React.MutableRefObject<number> }) {
  const { gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    el.tabIndex = 0;
    el.style.outline = "none";

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      yawRef.current -= e.movementX * 0.0026;
    };
    const onClick = () => {
      el.focus();
      el.requestPointerLock();
    };

    window.addEventListener("mousemove", onMove);
    el.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      el.removeEventListener("click", onClick);
    };
  }, [gl, yawRef]);

  return null;
}

function TerrainChunks() {
  /** Smaller cells → more frequent streaming updates, finer “tile” stepping while walking. */
  const chunkSize = 20;
  /** More rings → larger meshed area so distant ground spends more distance inside FogExp2. */
  const chunkRadius = 6;
  /** ~68k verts @ 13×20 m tiles, seg 20 — balance fog depth vs rebuild cost. */
  const segmentsPerTile = 20;
  const tiles = chunkRadius * 2 + 1;
  const span = tiles * chunkSize;
  const half = span * 0.5;
  const totalSeg = tiles * segmentsPerTile;
  const metersPerTextureRepeat = 24;
  const groundTex = useMemo(() => createGrassGroundTexture(), []);
  const groundDetailTex = useMemo(() => createGroundDetailTexture(), []);
  const groundMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: groundTex,
      color: new THREE.Color(0xfff4e0),
      roughness: 0.84,
      metalness: 0,
      flatShading: false,
    });
    patchGroundMeshStandardMaterial(m, { detailMap: groundDetailTex });
    return m;
  }, [groundTex, groundDetailTex]);

  const groupRef = useRef<THREE.Group>(null);
  const terrainMeshesRef = useRef<THREE.Mesh[]>([]);
  const fadingRef = useRef<{ mesh: THREE.Mesh; t: number }[]>([]);
  const lastCellRef = useRef<[number, number] | null>(null);
  const FADE_SEC = 0.16;

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;

    const dt = Math.min(0.05, state.clock.getDelta());
    for (let i = fadingRef.current.length - 1; i >= 0; i--) {
      const f = fadingRef.current[i]!;
      f.t += dt;
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 1 - f.t / FADE_SEC);
      if (f.t >= FADE_SEC) {
        g.remove(f.mesh);
        f.mesh.geometry.dispose();
        mat.dispose();
        fadingRef.current.splice(i, 1);
      }
    }

    const camera = state.camera;
    const px = camera.position.x;
    const pz = camera.position.z;
    const ccx = Math.floor(px / chunkSize);
    const ccz = Math.floor(pz / chunkSize);

    const prev = lastCellRef.current;
    if (
      prev &&
      prev[0] === ccx &&
      prev[1] === ccz &&
      terrainMeshesRef.current.length > 0
    ) {
      return;
    }
    lastCellRef.current = [ccx, ccz];

    for (const m of terrainMeshesRef.current) {
      const fadeMat = groundMat.clone();
      patchGroundMeshStandardMaterial(fadeMat, { detailMap: groundDetailTex });
      fadeMat.transparent = true;
      fadeMat.opacity = 1;
      fadeMat.depthWrite = false;
      m.material = fadeMat;
      m.renderOrder = 2;
      fadingRef.current.push({ mesh: m, t: 0 });
    }
    terrainMeshesRef.current = [];

    const minEdgeX = (ccx - chunkRadius) * chunkSize - chunkSize * 0.5;
    const minEdgeZ = (ccz - chunkRadius) * chunkSize - chunkSize * 0.5;
    const cx = minEdgeX + half;
    const cz = minEdgeZ + half;

    const innerGeo = new THREE.PlaneGeometry(span, span, totalSeg, totalSeg);
    innerGeo.rotateX(-Math.PI / 2);
    applyStaggeredPlaneTriangulation(innerGeo, totalSeg, totalSeg);
    const innerPos = innerGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < innerPos.count; i++) {
      const lx = innerPos.getX(i);
      const lz = innerPos.getZ(i);
      const wx = cx + lx;
      const wz = cz + lz;
      innerPos.setY(i, heightAt(wx, wz, { seed: TERRAIN_SEED }));
    }
    innerPos.needsUpdate = true;
    applyHeightfieldVertexNormalsPlane(
      innerGeo,
      minEdgeX,
      minEdgeZ,
      span,
      TERRAIN_SEED,
    );
    assignTerrainUVs(
      innerGeo,
      innerPos,
      TERRAIN_SEED,
      metersPerTextureRepeat,
      (lx, lz) => cx + lx,
      (lx, lz) => cz + lz,
    );
    innerGeo.computeBoundingSphere();

    const innerMesh = new THREE.Mesh(innerGeo, groundMat);
    innerMesh.position.set(cx, 0, cz);
    innerMesh.receiveShadow = true;
    innerMesh.castShadow = false;
    innerMesh.renderOrder = 1;
    g.add(innerMesh);
    terrainMeshesRef.current.push(innerMesh);
  });

  useEffect(() => {
    return () => {
      const g = groupRef.current;
      for (const m of terrainMeshesRef.current) {
        if (g) g.remove(m);
        m.geometry.dispose();
      }
      terrainMeshesRef.current = [];
      for (const f of fadingRef.current) {
        if (g) g.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
      }
      fadingRef.current = [];
      groundMat.dispose();
      groundTex.dispose();
      groundDetailTex.dispose();
    };
  }, [groundMat, groundTex, groundDetailTex]);

  return <group ref={groupRef} />;
}

/**
 * Piano + bench layout (meters), from the same abstract box used in-scene:
 * — `BoxGeometry(1.6, 1, 0.9)` at `(0.2, 0.5, -0.9)` → player-side z = -0.45.
 * — Bench: typical single seat ~76 cm × ~38 cm plan, seat top ~48 cm off floor
 *   (common fixed benches; e.g. designingidea.com/piano-bench-dimensions/).
 * — Seat centroid ~24 cm “out” from the key plane toward the player (+Z) so knees
 *   clear the fallboard (rule-of-thumb from piano ergonomics write-ups).
 */
const PIANO_MESH_POS = new THREE.Vector3(0.2, 0.5, -0.9);
const PIANO_MESH_HALF = new THREE.Vector3(0.8, 0.5, 0.45);
const PIANO_KEYS_FRONT_Z = PIANO_MESH_POS.z + PIANO_MESH_HALF.z;
const BENCH_SEAT_TOP_M = 0.48;
const BENCH_HALF_HEIGHT_M = 0.045;
const BENCH_PLAN_W_M = 0.76;
const BENCH_PLAN_D_M = 0.38;
const BENCH_CENTER_OFFSET_FROM_KEYS_M = 0.24;

function Centerpiece() {
  const rootRef = useRef<THREE.Group>(null);

  const pianoGeo = useMemo(() => new THREE.BoxGeometry(1.6, 1.0, 0.9), []);
  const benchGeo = useMemo(
    () =>
      new THREE.BoxGeometry(
        BENCH_PLAN_W_M,
        BENCH_HALF_HEIGHT_M * 2,
        BENCH_PLAN_D_M,
      ),
    [],
  );
  const pianoMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x343842,
        roughness: 0.82,
        metalness: 0.08,
        flatShading: true,
      }),
    [],
  );
  const benchMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x2a2420,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
    [],
  );

  useLayoutEffect(() => {
    const g = rootRef.current;
    if (!g) return;
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    const originGroundY = heightAt(0, 0, { seed: TERRAIN_SEED });
    const minY = bb.min.y;
    if (
      !bb.isEmpty() &&
      Number.isFinite(minY) &&
      Number.isFinite(bb.max.y) &&
      minY < bb.max.y
    ) {
      g.position.set(0, originGroundY - minY, 0);
    } else {
      // Skinned bounds can be empty before the mixer has applied a frame — keep piano base on terrain.
      g.position.set(0, originGroundY, 0);
    }
  }, []);

  useEffect(() => {
    return () => {
      pianoGeo.dispose();
      benchGeo.dispose();
      pianoMat.dispose();
      benchMat.dispose();
    };
  }, [benchGeo, benchMat, pianoGeo, pianoMat]);

  const benchCx = PIANO_MESH_POS.x;
  const benchCy = BENCH_SEAT_TOP_M - BENCH_HALF_HEIGHT_M;
  const benchCz = PIANO_KEYS_FRONT_Z + BENCH_CENTER_OFFSET_FROM_KEYS_M;

  return (
    <group ref={rootRef}>
      <mesh
        geometry={pianoGeo}
        material={pianoMat}
        position={PIANO_MESH_POS}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={benchGeo}
        material={benchMat}
        position={[benchCx, benchCy, benchCz]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

function WorldRoot({ room, displayName }: Props) {
  const { camera } = useThree();

  const yawRef = useRef(0);
  const keysRef = useRef(new Set<string>());
  const selfId = room.sessionId as string;

  const simRef = useRef<Map<string, SimPlayer>>(new Map());
  const [playerIds, setPlayerIds] = useState<string[]>([]);

  const moveSpeed = 6;
  const lastSendRef = useRef(0);
  /** Local player: prediction then smooth pull toward server each frame (single rate, no snap). */
  const SELF_RECONCILE = 0.22;
  const CAMERA_FOLLOW = 0.16;

  useEffect(() => {
    const down = (e: KeyboardEvent) => keysRef.current.add(e.code);
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const players = room.state.players as any;

    const refreshIds = () => {
      const ids: string[] = [];
      players.forEach((_p: any, key: string) => ids.push(key));
      setPlayerIds(ids);
    };

    const upsertSim = (p: any, key: string) => {
      if (simRef.current.has(key)) {
        refreshIds();
        return;
      }
      const sp: SimPlayer = {
        id: key,
        name: String(p.name ?? "Player"),
        server: new THREE.Vector3(p.x, 0, p.z),
        view: new THREE.Vector3(p.x, 0, p.z),
        yaw: p.yaw,
        lastPos: new THREE.Vector3(p.x, 0, p.z),
        lastT: performance.now() / 1000,
        speed: 0,
        moveAmount: { current: 0 },
        viewRef: { current: new THREE.Vector3(p.x, 0, p.z) },
        serverYawRef: { current: p.yaw },
      };
      simRef.current.set(key, sp);
      refreshIds();
    };

    const removeSim = (_p: any, key: string) => {
      simRef.current.delete(key);
      refreshIds();
    };

    // Must use .onAdd(fn) — assignment `players.onAdd = fn` does not register $callbacks, so late joins never appear.
    const offAdd = players.onAdd(upsertSim);
    const offRemove = players.onRemove(removeSim);

    // Safety net if anything is already present before listeners attach.
    players.forEach((p: any, key: string) => upsertSim(p, key));

    return () => {
      offAdd?.();
      offRemove?.();
    };
  }, [room]);

  useFrame((state) => {
    const dt = Math.min(0.05, state.clock.getDelta());
    const t = state.clock.elapsedTime * 1000;

    const forward =
      (keysRef.current.has("KeyW") ? 1 : 0) +
      (keysRef.current.has("KeyS") ? -1 : 0);
    const right =
      (keysRef.current.has("KeyD") ? 1 : 0) +
      (keysRef.current.has("KeyA") ? -1 : 0);

    if (t - lastSendRef.current > 16) {
      lastSendRef.current = t;
      room.send("input", { forward, right, yaw: yawRef.current });
    }

    // Pull authoritative positions each frame (cheap for MVP player counts).
    room.state.players.forEach((p: any, key: string) => {
      const sp = simRef.current.get(key);
      if (!sp) return;
      sp.name = String(p.name ?? "Player");
      sp.server.set(p.x, 0, p.z);
      sp.yaw = p.yaw;
      sp.serverYawRef.current = p.yaw;
    });

    const now = performance.now() / 1000;
    const sin = Math.sin(yawRef.current);
    const cos = Math.cos(yawRef.current);
    const predDx = (sin * forward - cos * right) * moveSpeed * dt;
    const predDz = (cos * forward + sin * right) * moveSpeed * dt;

    for (const sp of simRef.current.values()) {
      if (sp.id === selfId) {
        sp.view.x += predDx;
        sp.view.z += predDz;
        sp.view.lerp(sp.server, SELF_RECONCILE);
        sp.moveAmount.current = Math.min(
          1,
          Math.abs(forward) + Math.abs(right),
        );

        const dx = sp.view.x - sp.lastPos.x;
        const dz = sp.view.z - sp.lastPos.z;
        const dist = Math.hypot(dx, dz);
        const dtPos = Math.max(1e-4, now - sp.lastT);
        sp.speed = dist / dtPos;
        sp.lastPos.copy(sp.view);
        sp.lastT = now;
      } else {
        sp.view.lerp(sp.server, 0.18);
        const dx = sp.view.x - sp.lastPos.x;
        const dz = sp.view.z - sp.lastPos.z;
        const dist = Math.hypot(dx, dz);
        const dtPos = Math.max(1e-4, now - sp.lastT);
        sp.speed = dist / dtPos;
        sp.lastPos.copy(sp.view);
        sp.lastT = now;
        sp.moveAmount.current = Math.min(1, sp.speed / 4.5);
      }
      sp.viewRef.current.copy(sp.view);
    }

    const self = simRef.current.get(selfId);
    if (self) {
      const footY = heightAt(self.view.x, self.view.z, { seed: TERRAIN_SEED });
      const target = new THREE.Vector3(self.view.x, footY + 1.2, self.view.z);
      const behind = new THREE.Vector3(0, 0, 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yawRef.current,
      );
      const camPos = new THREE.Vector3(
        target.x - behind.x * 8,
        target.y + 5.2,
        target.z - behind.z * 8,
      );
      camera.position.lerp(camPos, CAMERA_FOLLOW);
      camera.lookAt(target);
    }
  });

  return (
    <>
      <PointerLock yawRef={yawRef} />
      <Sky
        distance={480000}
        sunPosition={SKY_SUN_POSITION}
        turbidity={6.4}
        rayleigh={2.35}
        mieCoefficient={0.0055}
        mieDirectionalG={0.82}
        material-fog={false}
      />
      <SkyBackdrop />
      <ambientLight intensity={0.14} color="#fff0e0" />
      <SunLights />
      <TerrainChunks />
      <RainEffect />
      <Centerpiece />

      {playerIds.map((id) => {
        const sp = simRef.current.get(id);
        if (!sp) return null;
        const isSelf = id === selfId;
        return (
          <PlayerAvatar
            key={id}
            displayName={isSelf ? displayName : sp.name}
            terrainSeed={TERRAIN_SEED}
            yawRef={yawRef}
            viewRef={sp.viewRef}
            moveAmountRef={sp.moveAmount}
            useCameraYaw={isSelf}
            serverYawRef={sp.serverYawRef}
          />
        );
      })}
    </>
  );
}

function SyncSceneFog(): null {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const fogColor = new THREE.Color(SCENE_FOG_COLOR_HEX);
    gl.setClearColor(fogColor, 1);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(fogColor, SCENE_FOG_EXP2_DENSITY);
    return () => {
      scene.fog = null;
    };
  }, [gl, scene, SCENE_FOG_EXP2_DENSITY, SCENE_FOG_COLOR_HEX]);
  return null;
}

export function WorldCanvas({ room, displayName, devAccessEnabled }: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 1]}
      gl={{ antialias: true }}
      camera={{ fov: 58, near: 0.1, far: 4500, position: [0, 6, 10] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.02;
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <SyncSceneFog />
      {devAccessEnabled ? <DevWorldCapture terrainSeed={TERRAIN_SEED} /> : null}
      <WorldRoot room={room} displayName={displayName} />
    </Canvas>
  );
}
