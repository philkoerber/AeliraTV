import {
  chunkKeysInSquare,
  chunkOrigin,
  parseChunkKey,
  surfaceHeightAt,
  terrainConfigFromContract,
  worldXZToChunk,
  type TerrainConfig,
} from "@aeliratv/shared-world";
import {
  Grid,
  KeyboardControls,
  PerformanceMonitor,
  Sky,
  Stats,
  useKeyboardControls,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Room } from "colyseus.js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import type { ChunkInterestPayload } from "../net.js";
import { reportChunkMetrics, reportChunkTileBuildMs } from "../perf/chunkMetricsBridge.js";
import { PerfProbe } from "../perf/PerfProbe.js";

type Props = {
  room: Room;
};

const PLAYER_HALF_HEIGHT = 0.55;

/** ~1 - exp(-λ dt) for stable smoothing across frame rates (use `useFrame` `delta`, not `clock.getDelta()`). */
function dampExp(dt: number, lambda: number): number {
  const t = Math.min(Math.max(dt, 0), 0.1);
  return 1 - Math.exp(-lambda * t);
}

function lerpAngleShortest(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Square window half-size in chunk units: 1 => 3×3, 2 => 5×5 (server clamps interest to 0..2). */
const CHUNK_VIEW_RADIUS = 2;

/** One `<Sky />` for horizon depth; set false if perf HUD regresses. */
const ENABLE_SKY = true;

/** Horizon / fog tint (linear fog + clear color family). */
const HORIZON_COLOR = "#8aa4b8";
const FOG_COLOR = "#6d8498";

const SEGMENTS_PER_CHUNK = 14;

/**
 * Horizontal distance from the chunk-window center to the outer boundary of loaded
 * terrain along ±X/±Z, for a square of (2*radius+1) chunks each `chunkSize` wide.
 * Outer face of the farthest ring: (radius + 0.5) * chunkSize.
 */
function terrainWindowEdgeDistanceXZ(chunkSize: number, radius: number): number {
  return (radius + 0.5) * chunkSize;
}

/**
 * Linear fog tuned so most of the loaded patch stays clear while the void past tile
 * edges blends into `FOG_COLOR` (see plan: edge-biased fog).
 */
function linearFogNearFarForChunkWindow(
  chunkSize: number,
  radius: number,
): { near: number; far: number } {
  const edge = terrainWindowEdgeDistanceXZ(chunkSize, radius);
  // Slightly steeper band vs edge so the last slice of terrain blends before the void (combo with larger window).
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
    color: "#c8d8ce",
    metalness: 0.04,
    roughness: 0.93,
    vertexColors: opts.vertexColors,
    flatShading: false,
  });
}

/** Deterministic [0,1) from integer grid — stable across runs (visual only). */
function hash01FromGrid(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) * 2 ** -32;
}

function writeGrassVertexColor(x: number, z: number, out: Float32Array, o: number): void {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const t = hash01FromGrid(ix, iz);
  const t2 = hash01FromGrid(ix + 101, iz - 67);
  out[o] = 0.09 + 0.07 * t;
  out[o + 1] = 0.16 + 0.11 * t2;
  out[o + 2] = 0.07 + 0.06 * t;
}

const SKY_SUN_POSITION = new THREE.Vector3(22, 36, -48);

type WorldContractSlice = {
  worldSeed: string;
  chunkSize: number;
};

function useWorldContract(room: Room): WorldContractSlice | null {
  const [c, setC] = useState<WorldContractSlice | null>(null);

  useEffect(() => {
    const sync = (): void => {
      const s = room.state as { worldSeed?: string; chunkSize?: number };
      const seed =
        typeof s.worldSeed === "string" && s.worldSeed.length > 0 ? s.worldSeed : "";
      const chunkSize =
        typeof s.chunkSize === "number" && Number.isFinite(s.chunkSize) && s.chunkSize > 0
          ? s.chunkSize
          : 0;
      if (!seed || !chunkSize) {
        setC(null);
        return;
      }
      setC((prev) =>
        prev?.worldSeed === seed && prev.chunkSize === chunkSize
          ? prev
          : { worldSeed: seed, chunkSize },
      );
    };
    room.onStateChange(sync);
    sync();
    return () => room.onStateChange.remove(sync);
  }, [room]);

  return c;
}

function buildChunkSurfaceGeometry(
  cx: number,
  cz: number,
  chunkSize: number,
  seg: number,
  cfg: TerrainConfig,
): THREE.BufferGeometry {
  const { x0, z0 } = chunkOrigin(cx, cz, chunkSize);
  const S = chunkSize;
  const positions = new Float32Array((seg + 1) * (seg + 1) * 3);
  const indices: number[] = [];
  let pi = 0;
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
  return g;
}

function ChunkTile({
  chunkKeyProp,
  chunkSize,
  cfg,
  segments,
  material,
}: {
  chunkKeyProp: string;
  chunkSize: number;
  cfg: TerrainConfig;
  segments: number;
  material: THREE.MeshStandardMaterial;
}): React.ReactElement {
  const { cx, cz } = parseChunkKey(chunkKeyProp);

  const geom = useMemo(() => {
    const t0 = performance.now();
    const g = buildChunkSurfaceGeometry(cx, cz, chunkSize, segments, cfg);
    reportChunkTileBuildMs(performance.now() - t0);
    return g;
  }, [cx, cz, chunkSize, segments, cfg]);

  useEffect(
    () => () => {
      geom.dispose();
    },
    [geom],
  );

  return <mesh geometry={geom} material={material} receiveShadow />;
}

function ChunkTerrainCoordinator({
  room,
  localSessionId,
  terrainCfg,
  chunkSize,
}: {
  room: Room;
  localSessionId: string;
  terrainCfg: TerrainConfig;
  chunkSize: number;
}): React.ReactElement {
  const terrainMaterial = useMemo(
    () => createTerrainGrassMaterial({ vertexColors: true }),
    [],
  );
  useEffect(
    () => () => {
      terrainMaterial.dispose();
    },
    [terrainMaterial],
  );

  const [keys, setKeys] = useState<string[]>(() =>
    chunkKeysInSquare(0, 0, CHUNK_VIEW_RADIUS),
  );
  const prevSerializedRef = useRef<string>("");

  useFrame(() => {
    const p = room.state.players.get(localSessionId);
    if (!p) return;
    const { cx, cz } = worldXZToChunk(p.x, p.z, chunkSize);
    const newKeys = chunkKeysInSquare(cx, cz, CHUNK_VIEW_RADIUS);
    const serialized = newKeys.join("|");
    if (serialized === prevSerializedRef.current) return;

    const t0 = performance.now();
    const prev = prevSerializedRef.current;
    const oldKeys = prev ? prev.split("|").filter(Boolean) : [];
    const newSet = new Set(newKeys);
    let evicted = 0;
    for (const k of oldKeys) {
      if (!newSet.has(k)) evicted += 1;
    }
    prevSerializedRef.current = serialized;
    reportChunkMetrics({
      loaded: newKeys.length,
      evictionsDelta: evicted,
      lastSwapMs: performance.now() - t0,
    });
    room.send("chunkInterest", { radius: CHUNK_VIEW_RADIUS } as ChunkInterestPayload);
    setKeys(newKeys);
  });

  return (
    <group>
      {keys.map((k) => (
        <ChunkTile
          key={k}
          chunkKeyProp={k}
          chunkSize={chunkSize}
          cfg={terrainCfg}
          segments={SEGMENTS_PER_CHUNK}
          material={terrainMaterial}
        />
      ))}
    </group>
  );
}

const KB = {
  forward: "forward",
  back: "back",
  left: "left",
  right: "right",
} as const;

function usePlayerSessionIds(room: Room): string[] {
  const [ids, setIds] = useState<string[]>(() =>
    Array.from(room.state.players.keys()),
  );

  useEffect(() => {
    const sync = () => setIds(Array.from(room.state.players.keys()));
    room.state.players.onAdd(sync);
    room.state.players.onRemove(sync);
    sync();
  }, [room]);

  return ids;
}

function PlayerBox({
  room,
  sessionId,
  isLocal,
  color,
}: {
  room: Room;
  sessionId: string;
  isLocal: boolean;
  color: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
  }, [sessionId]);

  useFrame((_, delta) => {
    const p = room.state.players.get(sessionId);
    const m = meshRef.current;
    if (!p || !m) return;
    const y =
      typeof p.y === "number" && Number.isFinite(p.y)
        ? p.y
        : PLAYER_HALF_HEIGHT;
    const kPos = dampExp(delta, isLocal ? 20 : 16);
    const kYaw = dampExp(delta, isLocal ? 26 : 18);
    if (!initializedRef.current) {
      m.position.set(p.x, y, p.z);
      m.rotation.y = p.yaw;
      initializedRef.current = true;
      return;
    }
    m.position.x += (p.x - m.position.x) * kPos;
    m.position.y += (y - m.position.y) * kPos;
    m.position.z += (p.z - m.position.z) * kPos;
    m.rotation.y = lerpAngleShortest(m.rotation.y, p.yaw, kYaw);
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[0.55, 1.1, 0.55]} />
      <meshStandardMaterial
        color={color}
        metalness={0.15}
        roughness={0.65}
        emissive={isLocal ? "#112211" : "#000000"}
      />
    </mesh>
  );
}

function LocalMotor({
  room,
  yawRef,
}: {
  room: Room;
  yawRef: React.MutableRefObject<number>;
}) {
  const [, get] = useKeyboardControls();

  useFrame(() => {
    const forward = (get()[KB.forward] ? 1 : 0) - (get()[KB.back] ? 1 : 0);
    const right = (get()[KB.right] ? 1 : 0) - (get()[KB.left] ? 1 : 0);
    room.send("input", {
      forward,
      right,
      yaw: yawRef.current,
    });
  });

  return null;
}

/** WoW-style orbit while pointer locked: horizontal = turn character / camera yaw, vertical = pitch. */
function OrbitLocalRig({
  room,
  localSessionId,
}: {
  room: Room;
  localSessionId: string;
}) {
  const yawRef = useRef(0);
  const pitchRef = useRef(0.34);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === null) return;
      yawRef.current -= e.movementX * 0.0022;
      pitchRef.current -= e.movementY * 0.0022;
      pitchRef.current = Math.max(0.1, Math.min(1.38, pitchRef.current));
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <>
      <LocalMotor room={room} yawRef={yawRef} />
      <ChaseCamera
        room={room}
        localSessionId={localSessionId}
        pitchRef={pitchRef}
      />
    </>
  );
}

function ChaseCamera({
  room,
  localSessionId,
  pitchRef,
}: {
  room: Room;
  localSessionId: string;
  pitchRef: React.MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const dist = 7.5;
  /** Aim point above player root (box center) — camera orbits this point. */
  const lookOffsetY = 0.38;
  const smoothPx = useRef(0);
  const smoothPy = useRef(0);
  const smoothPz = useRef(0);
  const smoothYaw = useRef(0);
  const orbitScratch = useRef(new THREE.Vector3());
  const camInitRef = useRef(false);

  useEffect(() => {
    camInitRef.current = false;
  }, [localSessionId]);

  useFrame((_, delta) => {
    const p = room.state.players.get(localSessionId);
    if (!p) return;

    const py =
      typeof p.y === "number" && Number.isFinite(p.y)
        ? p.y
        : PLAYER_HALF_HEIGHT;
    const kFollow = dampExp(delta, 17);
    const kYaw = dampExp(delta, 22);
    if (!camInitRef.current) {
      smoothPx.current = p.x;
      smoothPy.current = py;
      smoothPz.current = p.z;
      smoothYaw.current = p.yaw;
      camInitRef.current = true;
    } else {
      smoothPx.current += (p.x - smoothPx.current) * kFollow;
      smoothPy.current += (py - smoothPy.current) * kFollow;
      smoothPz.current += (p.z - smoothPz.current) * kFollow;
      smoothYaw.current = lerpAngleShortest(smoothYaw.current, p.yaw, kYaw);
    }

    const lookY = smoothPy.current + lookOffsetY;
    const yaw = smoothYaw.current;
    const pitch = pitchRef.current;
    const theta = yaw + Math.PI;
    const ox = smoothPx.current + dist * Math.cos(pitch) * Math.sin(theta);
    const oy = lookY + dist * Math.sin(pitch);
    const oz = smoothPz.current + dist * Math.cos(pitch) * Math.cos(theta);
    orbitScratch.current.set(ox, oy, oz);
    const kCam = dampExp(delta, 14);
    camera.position.lerp(orbitScratch.current, kCam);
    camera.lookAt(smoothPx.current, lookY, smoothPz.current);
  });

  return null;
}

function Scene({ room }: Props) {
  const localSessionId = room.sessionId;
  const ids = usePlayerSessionIds(room);
  const contract = useWorldContract(room);
  const terrainCfg = useMemo(
    () =>
      contract ? terrainConfigFromContract({ worldSeed: contract.worldSeed }) : null,
    [contract],
  );

  const { fogNear, fogFar } = useMemo(() => {
    const chunkSize = contract?.chunkSize ?? 64;
    const { near, far } = linearFogNearFarForChunkWindow(
      chunkSize,
      CHUNK_VIEW_RADIUS,
    );
    return { fogNear: near, fogFar: far };
  }, [contract?.chunkSize]);

  const originRingY = terrainCfg
    ? surfaceHeightAt(0, 0, terrainCfg) + 0.04
    : 0.04;

  const colorFor = useCallback(
    (sessionId: string, i: number) => {
      if (sessionId === localSessionId) return "#6ecf8e";
      const hue = ((i * 47) % 360) / 360;
      return new THREE.Color().setHSL(hue, 0.45, 0.55).getStyle();
    },
    [localSessionId],
  );

  const map = useMemo(
    () => [
      { name: KB.forward, keys: ["KeyW", "ArrowUp"] },
      { name: KB.back, keys: ["KeyS", "ArrowDown"] },
      { name: KB.left, keys: ["KeyA", "ArrowLeft"] },
      { name: KB.right, keys: ["KeyD", "ArrowRight"] },
    ],
    [],
  );

  return (
    <KeyboardControls map={map}>
      <color attach="background" args={[HORIZON_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />

      {ENABLE_SKY ? (
        <Sky
          distance={450000}
          mieCoefficient={0.0032}
          mieDirectionalG={0.75}
          rayleigh={0.55}
          turbidity={8}
          sunPosition={SKY_SUN_POSITION}
        />
      ) : null}

      <ambientLight intensity={0.44} />
      <directionalLight
        castShadow
        position={[18, 28, 10]}
        intensity={1.14}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={80}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />

      {contract && terrainCfg ? (
        <ChunkTerrainCoordinator
          room={room}
          localSessionId={localSessionId}
          terrainCfg={terrainCfg}
          chunkSize={contract.chunkSize}
        />
      ) : (
        <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0, 0]}>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial
            color="#c8d8ce"
            metalness={0.04}
            roughness={0.93}
            vertexColors={false}
            flatShading={false}
          />
        </mesh>
      )}

      <Grid
        infiniteGrid
        fadeDistance={100}
        fadeStrength={1.2}
        sectionSize={5}
        cellSize={1}
        sectionColor="#3d4f66"
        cellColor="#2a3545"
      />

      {ids.map((sessionId, i) => (
        <PlayerBox
          key={sessionId}
          room={room}
          sessionId={sessionId}
          isLocal={sessionId === localSessionId}
          color={colorFor(sessionId, i)}
        />
      ))}

      <OrbitLocalRig room={room} localSessionId={localSessionId} />

      {/* Origin marker — future “piano girl” anchor at (0,0) */}
      <mesh position={[0, originRingY, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.35, 0.5, 32]} />
        <meshBasicMaterial
          color="#c9b87a"
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
    </KeyboardControls>
  );
}

export function WorldCanvas({ room }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dprScale, setDprScale] = useState(1);
  const [showDreiStats, setShowDreiStats] = useState(false);

  const dpr = useMemo((): [number, number] => {
    const lo = Math.max(0.5, 1 * dprScale);
    const hi = Math.max(lo + 0.05, Math.min(2, 1.75 * dprScale));
    return [lo, hi];
  }, [dprScale]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && !e.repeat) {
        e.preventDefault();
        setShowDreiStats((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const requestLock = useCallback(() => {
    canvasRef.current?.querySelector("canvas")?.requestPointerLock();
  }, []);

  return (
    <div
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        cursor: "crosshair",
      }}
    >
      <Canvas
        style={{ width: "100%", height: "100%", display: "block" }}
        shadows
        camera={{ fov: 55, near: 0.1, far: 240, position: [0, 6, 10] }}
        dpr={dpr}
        onPointerDown={requestLock}
      >
        <PerformanceMonitor
          flipflops={48}
          onIncline={() =>
            setDprScale((s) => Math.min(1, Math.round((s + 0.1) * 1000) / 1000))
          }
          onDecline={() =>
            setDprScale((s) =>
              Math.max(0.55, Math.round((s - 0.1) * 1000) / 1000),
            )
          }
        >
          <PerfProbe />
          <Scene room={room} />
          {import.meta.env.DEV && showDreiStats ? <Stats /> : null}
        </PerformanceMonitor>
      </Canvas>
    </div>
  );
}
