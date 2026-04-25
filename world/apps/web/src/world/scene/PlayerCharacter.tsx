import { useAnimations, useFBX, useKeyboardControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Room } from "colyseus.js";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

const PLAYER_HALF_HEIGHT = 0.55;

const CHARACTER_SCALE = 0.01;
const CHARACTER_YAW_OFFSET = 0;
const CHARACTER_ANIM_SPEED = 0.75;

const CHARACTER_RUN_FWD_URL = "/characters/Running Foreward.fbx";
const CHARACTER_RUN_BACK_URL = "/characters/Running Backward.fbx";
const CHARACTER_IDLE_URL = "/characters/Idle.fbx";
const CHARACTER_LEFT_URL = "/characters/Left Strafe.fbx";
const CHARACTER_RIGHT_URL = "/characters/Right Strafe.fbx";
const CHARACTER_FWD_LEFT_URL = "/characters/Foreward Left Strafe.fbx";
const CHARACTER_FWD_RIGHT_URL = "/characters/Foreward Right Strafe.fbx";
const CHARACTER_BACK_LEFT_URL = "/characters/Backward Left Strafe.fbx";
const CHARACTER_BACK_RIGHT_URL = "/characters/Backward Right Strafe.fbx";

type MoveIntent = {
  forward: number; // -1..1
  right: number; // -1..1
};

type Props = {
  room: Room;
  sessionId: string;
  isLocal: boolean;
  color: string;
  getVisualY: (x: number, z: number) => number | null;
};

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pickActionName(
  intent: MoveIntent,
):
  | "Idle"
  | "RunForward"
  | "RunBackward"
  | "Left"
  | "Right"
  | "ForwardLeft"
  | "ForwardRight"
  | "BackwardLeft"
  | "BackwardRight" {
  const f = intent.forward;
  const r = intent.right;
  const moving = Math.abs(f) > 0.1 || Math.abs(r) > 0.1;
  if (!moving) return "Idle";

  if (f < -0.35 && r < -0.35) return "BackwardLeft";
  if (f < -0.35 && r > 0.35) return "BackwardRight";
  if (f < -0.35 && Math.abs(r) < 0.35) return "RunBackward";
  if (Math.abs(f) < 0.35 && r < -0.35) return "Left";
  if (Math.abs(f) < 0.35 && r > 0.35) return "Right";

  if (f > 0.35 && r < -0.35) return "ForwardLeft";
  if (f > 0.35 && r > 0.35) return "ForwardRight";
  return "RunForward";
}

function localIntentFromVelocityWorld(
  vx: number,
  vz: number,
  yaw: number,
): MoveIntent {
  // Inverse of server movement mapping:
  // dx = (sin*yaw * f - cos*yaw * r) * speed
  // dz = (cos*yaw * f + sin*yaw * r) * speed
  // => f ∝ sin*yaw*dx + cos*yaw*dz
  // => r ∝ -cos*yaw*dx + sin*yaw*dz
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    forward: sin * vx + cos * vz,
    right: -cos * vx + sin * vz,
  };
}

function cloneWithShadows(root: THREE.Object3D): THREE.Object3D {
  const c = SkeletonUtils.clone(root) as THREE.Object3D;
  c.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return c;
}

export function PlayerCharacter({
  room,
  sessionId,
  isLocal,
  color,
  getVisualY,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const initializedRef = useRef(false);
  const lastCenterYRef = useRef<number>(PLAYER_HALF_HEIGHT);
  const prevRenderRef = useRef<{ x: number; z: number } | null>(null);
  const currentActionRef = useRef<string>("Idle");
  const lastSwitchAtRef = useRef(0);
  const intentSmoothRef = useRef<MoveIntent>({ forward: 0, right: 0 });
  const [, get] = useKeyboardControls();

  const idle = useFBX(CHARACTER_IDLE_URL);
  const runFwd = useFBX(CHARACTER_RUN_FWD_URL);
  const runBack = useFBX(CHARACTER_RUN_BACK_URL);
  const left = useFBX(CHARACTER_LEFT_URL);
  const right = useFBX(CHARACTER_RIGHT_URL);
  const fwdLeft = useFBX(CHARACTER_FWD_LEFT_URL);
  const fwdRight = useFBX(CHARACTER_FWD_RIGHT_URL);
  const backLeft = useFBX(CHARACTER_BACK_LEFT_URL);
  const backRight = useFBX(CHARACTER_BACK_RIGHT_URL);

  // Render mesh source: use the RunForward FBX (it includes the skinned mesh).
  const characterScene = useMemo(() => cloneWithShadows(runFwd), [runFwd]);

  const clips = useMemo(() => {
    const out: THREE.AnimationClip[] = [];
    const first = (g: unknown): THREE.AnimationClip | null => {
      const a = (g as { animations?: THREE.AnimationClip[] }).animations ?? [];
      return a[0] ?? null;
    };
    const push = (clip: THREE.AnimationClip | null, name: string) => {
      if (!clip) return;
      const c = clip.clone();
      c.name = name;
      out.push(c);
    };
    push(first(idle), "Idle");
    push(first(runFwd), "RunForward");
    push(first(runBack), "RunBackward");
    push(first(left), "Left");
    push(first(right), "Right");
    push(first(fwdLeft), "ForwardLeft");
    push(first(fwdRight), "ForwardRight");
    push(first(backLeft), "BackwardLeft");
    push(first(backRight), "BackwardRight");
    return out;
  }, [
    idle,
    runBack,
    runFwd,
    left,
    right,
    fwdLeft,
    fwdRight,
    backLeft,
    backRight,
  ]);

  const { actions, mixer } = useAnimations(clips, groupRef);

  useEffect(() => {
    initializedRef.current = false;
    prevRenderRef.current = null;
    currentActionRef.current = "Idle";
    lastSwitchAtRef.current = 0;
    intentSmoothRef.current = { forward: 0, right: 0 };
    for (const a of Object.values(actions ?? {})) a?.stop?.();
  }, [sessionId, actions]);

  useEffect(() => {
    const a = actions?.Idle;
    if (!a) return;
    a.timeScale = CHARACTER_ANIM_SPEED;
    a.reset().fadeIn(0.12).play();
    return () => {
      a.fadeOut(0.1);
    };
  }, [actions]);

  useFrame((_, delta) => {
    const p = room.state.players.get(sessionId);
    const g = groupRef.current;
    if (!p || !g) return;

    const visualGround = getVisualY(p.x, p.z);
    const centerY =
      visualGround !== null
        ? visualGround + PLAYER_HALF_HEIGHT
        : typeof p.y === "number" && Number.isFinite(p.y)
          ? p.y
          : lastCenterYRef.current;
    lastCenterYRef.current = centerY;
    const yFeetTarget = centerY - PLAYER_HALF_HEIGHT;

    const dt = Math.max(1e-4, delta);

    const kPos = dampExp(delta, isLocal ? 20 : 16);
    const kY = dampExp(delta, isLocal ? 34 : 28);
    const kYaw = dampExp(delta, isLocal ? 26 : 18);

    if (!initializedRef.current) {
      g.position.set(p.x, yFeetTarget, p.z);
      g.rotation.y = p.yaw + CHARACTER_YAW_OFFSET;
      initializedRef.current = true;
      prevRenderRef.current = { x: g.position.x, z: g.position.z };
      return;
    }

    // Capture previous render position for velocity/intents.
    const prevRender = prevRenderRef.current ?? {
      x: g.position.x,
      z: g.position.z,
    };

    g.position.x += (p.x - g.position.x) * kPos;
    g.position.z += (p.z - g.position.z) * kPos;
    g.position.y += (yFeetTarget - g.position.y) * kY;
    g.rotation.y = lerpAngleShortest(
      g.rotation.y,
      p.yaw + CHARACTER_YAW_OFFSET,
      kYaw,
    );

    // Intent selection (after smoothing so remotes get non-zero velocity).
    let intent: MoveIntent = { forward: 0, right: 0 };
    if (isLocal) {
      const forward = (get()["forward"] ? 1 : 0) - (get()["back"] ? 1 : 0);
      const right = (get()["right"] ? 1 : 0) - (get()["left"] ? 1 : 0);
      intent = { forward, right };
    } else {
      const vx = (g.position.x - prevRender.x) / dt;
      const vz = (g.position.z - prevRender.z) / dt;
      const yaw = g.rotation.y - CHARACTER_YAW_OFFSET;
      intent = localIntentFromVelocityWorld(vx, vz, yaw);
      // Clamp to the same -1..1-ish space as local input.
      intent.forward = clamp(intent.forward, -1, 1);
      intent.right = clamp(intent.right, -1, 1);
    }

    // Smooth intent to avoid flicker near thresholds (especially remotes).
    const kIntent = dampExp(delta, isLocal ? 26 : 10);
    intentSmoothRef.current.forward = lerp(
      intentSmoothRef.current.forward,
      intent.forward,
      kIntent,
    );
    intentSmoothRef.current.right = lerp(
      intentSmoothRef.current.right,
      intent.right,
      kIntent,
    );

    const intentSm = intentSmoothRef.current;
    const desired = pickActionName(intentSm);
    const nowMs = performance.now();
    const minSwitchMs = isLocal ? 0 : 140;
    if (
      desired !== currentActionRef.current &&
      nowMs - lastSwitchAtRef.current >= minSwitchMs
    ) {
      const prev = actions?.[currentActionRef.current as keyof typeof actions];
      const next = actions?.[desired as keyof typeof actions];
      prev?.fadeOut?.(0.12);
      if (next) {
        next.timeScale = CHARACTER_ANIM_SPEED;
        next.reset().fadeIn(0.12).play();
      }
      currentActionRef.current = desired;
      lastSwitchAtRef.current = nowMs;
    }

    // Slight timeScale based on magnitude, but normalize diagonals so W+A isn't faster than W.
    const magRaw = Math.hypot(intentSm.forward, intentSm.right);
    const mag = Math.min(1, magRaw / Math.SQRT2);
    const active = actions?.[currentActionRef.current as keyof typeof actions];
    if (active) {
      const base =
        currentActionRef.current === "Idle"
          ? 1
          : Math.max(0.7, Math.min(1.5, mag));
      active.timeScale = base * CHARACTER_ANIM_SPEED;
    }

    mixer?.update?.(dt);

    // Update render-velocity reference after smoothing.
    prevRenderRef.current = { x: g.position.x, z: g.position.z };
  });

  return (
    <group ref={groupRef} scale={CHARACTER_SCALE}>
      <primitive object={characterScene} />
      <mesh position={[0, PLAYER_HALF_HEIGHT * 1.55, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial
          emissive={isLocal ? "#224422" : "#000000"}
          color={color}
        />
      </mesh>
    </group>
  );
}
