import {
  surfaceHeightAt,
  terrainConfigFromContract,
  type DecorOverrides,
  type TerrainConfig,
} from "@aeliratv/shared-world";
import {
  Grid,
  KeyboardControls,
  PerformanceMonitor,
  Sky,
  Stats,
  useGLTF,
  useTexture,
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
import { PerfProbe } from "../perf/PerfProbe.js";
import { PlayerCharacter } from "./PlayerCharacter";
import {
  ChunkPropsCoordinator,
  type ChunkPropsBuildsHandle,
} from "./props/ChunkPropsCoordinator.js";
import {
  ChunkPropsRenderer,
} from "./props/ChunkPropsRenderer.js";
import {
  decorOverridesFromOverlayMessage,
  type DecorOverlayMessageV1,
} from "./props/decorOverlay.js";
import {
  CHUNK_PRELOAD_RADIUS,
  ChunkTerrainCoordinator,
  linearFogNearFarForChunkWindow,
  meshHeightAtXZ,
  type ChunkHeightField,
} from "./terrain/ChunkTerrain";

type Props = {
  room: Room;
};

const PLAYER_HALF_HEIGHT = 0.55;

const ORIGIN_PIANO_URL = "/world-origin/piano.glb";
const ORIGIN_PIANO_SCALE = 0.15;
const ORIGIN_PIANO_YAW = 0;
const ORIGIN_PIANO_Y_OFFSET = 0;

// Character rendering/animation lives in `PlayerCharacter.tsx`.

const SKY_TEXTURE_URL = "/sky/sky.png";
const TEXTURE_SKY_Y_OFFSET = -0.35;

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

function OriginPiano({ y }: { y: number }): React.ReactElement {
  const gltf = useGLTF(ORIGIN_PIANO_URL);

  useEffect(() => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }, [gltf.scene]);

  return (
    <primitive
      object={gltf.scene}
      position={[0, y + ORIGIN_PIANO_Y_OFFSET, 0]}
      rotation={[0, ORIGIN_PIANO_YAW, 0]}
      scale={ORIGIN_PIANO_SCALE}
    />
  );
}

// (removed: character asset/animation helpers)

/** One `<Sky />` for horizon depth; set false if perf HUD regresses. */
const ENABLE_SKY = true;

/** If true, uses `public/sky/sky.png` as an inward-facing dome instead of procedural sky. */
const ENABLE_TEXTURE_SKY = true;

/** Horizon / fog tint (linear fog + clear color family). */
const HORIZON_COLOR = "#8aa4b8";
const FOG_COLOR = "#6d8498";

const SKY_SUN_POSITION = new THREE.Vector3(22, 36, -48);

// Cheap near-field shadows: keep a small shadow box centered on the local player.
const SUN_SHADOW_BOX_RADIUS = 22; // world units, controls shadow coverage
const SUN_SHADOW_FAR = 85;
const SUN_SHADOW_NEAR = 1;
const SUN_SHADOW_MAP_SIZE = 1024;
const SUN_FOLLOW_OFFSET = new THREE.Vector3(18, 20, 10);

function TexturedSkySphere(): React.ReactElement {
  const tex = useTexture(SKY_TEXTURE_URL);
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, gl } = useThree();

  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return null;
  }, [gl.capabilities, tex]);

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    m.position.set(
      camera.position.x,
      camera.position.y + TEXTURE_SKY_Y_OFFSET,
      camera.position.z,
    );
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={-100}>
      <sphereGeometry args={[210, 48, 24]} />
      <meshBasicMaterial
        map={tex}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

type WorldContractSlice = {
  worldSeed: string;
  chunkSize: number;
  rulesetVersion: number;
  generatorBuild: number;
};

function useWorldContract(room: Room): WorldContractSlice | null {
  const [c, setC] = useState<WorldContractSlice | null>(null);

  useEffect(() => {
    const sync = (): void => {
      const s = room.state as {
        worldSeed?: string;
        chunkSize?: number;
        rulesetVersion?: number;
        generatorBuild?: number;
      };
      const seed =
        typeof s.worldSeed === "string" && s.worldSeed.length > 0
          ? s.worldSeed
          : "";
      const chunkSize =
        typeof s.chunkSize === "number" &&
        Number.isFinite(s.chunkSize) &&
        s.chunkSize > 0
          ? s.chunkSize
          : 0;
      const rulesetVersion =
        typeof s.rulesetVersion === "number" && Number.isFinite(s.rulesetVersion)
          ? s.rulesetVersion
          : 0;
      const generatorBuild =
        typeof s.generatorBuild === "number" && Number.isFinite(s.generatorBuild)
          ? s.generatorBuild
          : 0;
      if (!seed || !chunkSize) {
        setC(null);
        return;
      }
      setC((prev) =>
        prev &&
        prev.worldSeed === seed &&
        prev.chunkSize === chunkSize &&
        prev.rulesetVersion === rulesetVersion &&
        prev.generatorBuild === generatorBuild
          ? prev
          : {
              worldSeed: seed,
              chunkSize,
              rulesetVersion,
              generatorBuild,
            },
      );
    };
    room.onStateChange(sync);
    sync();
    return () => room.onStateChange.remove(sync);
  }, [room]);

  return c;
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

// (removed: PlayerBox)

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
  getVisualY,
}: {
  room: Room;
  localSessionId: string;
  getVisualY: (x: number, z: number) => number | null;
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
        getVisualY={getVisualY}
      />
    </>
  );
}

function ChaseCamera({
  room,
  localSessionId,
  pitchRef,
  getVisualY,
}: {
  room: Room;
  localSessionId: string;
  pitchRef: React.MutableRefObject<number>;
  getVisualY: (x: number, z: number) => number | null;
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

    const visualGround = getVisualY(p.x, p.z);
    const py =
      visualGround !== null
        ? visualGround + PLAYER_HALF_HEIGHT
        : typeof p.y === "number" && Number.isFinite(p.y)
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

function SunShadowRig({
  room,
  localSessionId,
  lightRef,
  target,
}: {
  room: Room;
  localSessionId: string;
  lightRef: React.RefObject<THREE.DirectionalLight | null>;
  target: THREE.Object3D;
}) {
  const prevCenter = useRef(
    new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
  );

  useFrame(() => {
    const p = room.state.players.get(localSessionId);
    const sun = lightRef.current;
    if (!p || !sun) return;

    // Follow player on XZ; keep target slightly above ground.
    const cx = p.x;
    const cz = p.z;
    const cy =
      (typeof p.y === "number" && Number.isFinite(p.y) ? p.y : 0) + 0.35;

    // Skip tiny updates to avoid extra work.
    const dx = cx - prevCenter.current.x;
    const dz = cz - prevCenter.current.z;
    const movedFar = !(
      Number.isFinite(prevCenter.current.x) && dx * dx + dz * dz < 0.25
    );
    if (!movedFar) return;

    prevCenter.current.set(cx, cy, cz);
    target.position.set(cx, cy, cz);
    sun.position.copy(target.position).add(SUN_FOLLOW_OFFSET);

    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SUN_SHADOW_BOX_RADIUS;
    cam.right = SUN_SHADOW_BOX_RADIUS;
    cam.top = SUN_SHADOW_BOX_RADIUS;
    cam.bottom = -SUN_SHADOW_BOX_RADIUS;
    cam.near = SUN_SHADOW_NEAR;
    cam.far = SUN_SHADOW_FAR;
    cam.updateProjectionMatrix();

    sun.target.updateMatrixWorld();
  });

  return null;
}

function Scene({ room }: Props) {
  const localSessionId = room.sessionId;
  const ids = usePlayerSessionIds(room);
  const contract = useWorldContract(room);
  const heightFieldsRef = useRef<Map<string, ChunkHeightField>>(new Map());
  const decorOverridesRef = useRef<DecorOverrides | undefined>(undefined);
  const chunkPropsBuildsRef = useRef<ChunkPropsBuildsHandle>({
    version: 0,
    byChunkKey: new Map(),
  });
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const getVisualY = useCallback(
    (x: number, z: number) => {
      const chunkSize = contract?.chunkSize ?? 64;
      return meshHeightAtXZ(x, z, heightFieldsRef.current, chunkSize);
    },
    [contract?.chunkSize],
  );
  const terrainCfg = useMemo(
    () =>
      contract
        ? terrainConfigFromContract({ worldSeed: contract.worldSeed })
        : null,
    [contract],
  );

  const { fogNear, fogFar } = useMemo(() => {
    const chunkSize = contract?.chunkSize ?? 64;
    const { near, far } = linearFogNearFarForChunkWindow(
      chunkSize,
      CHUNK_PRELOAD_RADIUS,
    );
    return { fogNear: near, fogFar: far };
  }, [contract?.chunkSize]);

  const originRingY = terrainCfg
    ? surfaceHeightAt(0, 0, terrainCfg) + 0.04
    : 0.04;

  useEffect(() => {
    const onDecorOverlay = (msg: DecorOverlayMessageV1) => {
      if (!msg || msg.v !== 1) return;
      decorOverridesRef.current = decorOverridesFromOverlayMessage(msg);
    };
    room.onMessage("decor_overlay", onDecorOverlay);
  }, [room]);

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

      {ENABLE_TEXTURE_SKY ? (
        <TexturedSkySphere />
      ) : ENABLE_SKY ? (
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
        ref={sunRef}
        castShadow
        position={[18, 20, 10]}
        intensity={1.14}
        target={sunTarget}
        shadow-mapSize-width={SUN_SHADOW_MAP_SIZE}
        shadow-mapSize-height={SUN_SHADOW_MAP_SIZE}
        shadow-camera-near={SUN_SHADOW_NEAR}
        shadow-camera-far={SUN_SHADOW_FAR}
        shadow-camera-left={-SUN_SHADOW_BOX_RADIUS}
        shadow-camera-right={SUN_SHADOW_BOX_RADIUS}
        shadow-camera-top={SUN_SHADOW_BOX_RADIUS}
        shadow-camera-bottom={-SUN_SHADOW_BOX_RADIUS}
        shadow-bias={-0.00025}
        shadow-normalBias={0.02}
      />
      <primitive object={sunTarget} />
      <SunShadowRig
        room={room}
        localSessionId={localSessionId}
        lightRef={sunRef}
        target={sunTarget}
      />

      {contract && terrainCfg ? (
        <>
          <ChunkTerrainCoordinator
            room={room}
            localSessionId={localSessionId}
            terrainCfg={terrainCfg}
            chunkSize={contract.chunkSize}
            onHeightField={(chunkKey, field) => {
              if (field) heightFieldsRef.current.set(chunkKey, field);
              else heightFieldsRef.current.delete(chunkKey);
            }}
          />
          <ChunkPropsCoordinator
            room={room}
            localSessionId={localSessionId}
            terrainCfg={terrainCfg}
            chunkSize={contract.chunkSize}
            decorContract={{
              worldSeed: contract.worldSeed,
              rulesetVersion: contract.rulesetVersion,
              generatorBuild: contract.generatorBuild,
            }}
            heightFieldsRef={heightFieldsRef}
            handleRef={chunkPropsBuildsRef}
            decorOverridesRef={decorOverridesRef}
          />
          <ChunkPropsRenderer
            buildsRef={chunkPropsBuildsRef}
            room={room}
            localSessionId={localSessionId}
          />
        </>
      ) : (
        <mesh
          rotation-x={-Math.PI / 2}
          castShadow
          receiveShadow
          position={[0, 0, 0]}
        >
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
        <PlayerCharacter
          key={sessionId}
          room={room}
          sessionId={sessionId}
          isLocal={sessionId === localSessionId}
          color={colorFor(sessionId, i)}
          getVisualY={getVisualY}
        />
      ))}

      <OrbitLocalRig
        room={room}
        localSessionId={localSessionId}
        getVisualY={getVisualY}
      />

      {terrainCfg ? (
        <OriginPiano y={surfaceHeightAt(0, 0, terrainCfg)} />
      ) : null}

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
