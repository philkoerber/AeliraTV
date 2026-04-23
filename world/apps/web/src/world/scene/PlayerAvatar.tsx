import React, { useEffect, useMemo, useRef } from "react";
import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { heightAt } from "@aeliratv/shared-world";

type Props = {
  displayName: string;
  terrainSeed?: number;
  /** radians, world yaw around Y */
  yawRef: React.MutableRefObject<number>;
  /** feet XZ in world space (updated externally each frame) */
  viewRef: React.MutableRefObject<THREE.Vector3>;
  /** 0..1-ish movement intensity (local: from keys; remote: estimated) */
  moveAmountRef: React.MutableRefObject<number>;
  /** if true, yaw comes from yawRef (camera). if false, yaw comes from server yaw ref */
  useCameraYaw: boolean;
  serverYawRef: React.MutableRefObject<number>;
};

const MODEL_URL = "/characters/player.glb";
// Movement uses (sin(yaw), cos(yaw)) in XZ; Three.js rotation.y maps local +Z to that same direction.
// Add ±π/2 only if an asset's mesh forward axis is not +Z.
const MODEL_YAW_OFFSET = 0;
/** <1 slows the run/walk clip slightly (default glTF speed is often a bit snappy). */
const LOCOMOTION_TIME_SCALE = 0.5;

function pickActionName(
  actions: Record<string, THREE.AnimationAction | null>,
  candidates: string[],
): string | null {
  const keys = Object.keys(actions);
  for (const c of candidates) {
    const exact = keys.find((k) => k === c);
    if (exact) return exact;
  }
  for (const c of candidates) {
    const ci = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (ci) return ci;
  }
  for (const c of candidates) {
    const partial = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()));
    if (partial) return partial;
  }
  return keys[0] ?? null;
}

function estimateStandingHeightMeters(root: THREE.Object3D): number {
  // Skinned meshes: `position` attributes are usually bind-pose in a tiny normalized space, so a naive
  // vertex scan can report ~0.02m "height" and explode scale. Prefer Three's skinned AABB path.
  root.updateMatrixWorld(true);

  let hasSkinned = false;
  root.traverse((obj) => {
    const sm = obj as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) hasSkinned = true;
  });

  if (hasSkinned) {
    const bb = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bb.getSize(size);
    return Math.max(1e-3, size.y);
  }

  // Rigid meshes: vertex extents in world space are reliable.
  let maxY = -Infinity;
  let minY = Infinity;
  const tmp = new THREE.Vector3();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      maxY = Math.max(maxY, tmp.y);
      minY = Math.min(minY, tmp.y);
    }
  });
  if (Number.isFinite(maxY) && Number.isFinite(minY)) {
    return Math.max(1e-3, maxY - minY);
  }

  const bb = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bb.getSize(size);
  return Math.max(1e-3, size.y);
}

export function PlayerAvatar({
  displayName,
  terrainSeed = 7741,
  yawRef,
  viewRef,
  moveAmountRef,
  useCameraYaw,
  serverYawRef,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const gltf = useGLTF(MODEL_URL);
  const clone = useMemo(
    () => SkeletonUtils.clone(gltf.scene) as THREE.Object3D,
    [gltf.scene],
  );
  const { animations } = gltf;

  // Normalize scale once: target ~1.75m tall (human-ish silhouette for an RPG MVP).
  const normalized = useMemo(() => {
    clone.updateMatrixWorld(true);
    const h0 = estimateStandingHeightMeters(clone);
    const targetH = 1.75;
    // Clamp prevents absurd scales if a model has stray verts / bad skin bounds.
    const h = THREE.MathUtils.clamp(h0, 0.35, 4.5);
    const s = targetH / h;
    clone.scale.setScalar(s);
    clone.updateMatrixWorld(true);

    // Foot/head offsets after scaling (still use AABB on the scaled root; usually OK for placement).
    const bb2 = new THREE.Box3().setFromObject(clone);
    const footY = bb2.min.y;
    const headY = bb2.max.y;

    clone.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });

    return { footY, headY };
  }, [clone]);

  const { actions, mixer } = useAnimations(animations, clone);

  const idleName = useMemo(
    () =>
      pickActionName(actions, [
        "idle",
        "Idle",
        "Survey",
        "Idle_001",
        "Armature|idle",
        "TPose",
      ]),
    [actions],
  );
  /** Moving clip: prefer run over walk when the GLB has both (e.g. Xbot). */
  const locomotionName = useMemo(
    () =>
      pickActionName(actions, [
        "run",
        "Run",
        "running",
        "Running",
        "sprint",
        "Sprint",
        "jog",
        "Jog",
        "Armature|run",
        "walk",
        "Walk",
        "Walking",
        "Armature|walk",
      ]),
    [actions],
  );
  const singleName = useMemo(() => {
    const keys = Object.keys(actions);
    if (keys.length === 1) return keys[0] ?? null;
    return null;
  }, [actions]);

  const activeRef = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    // Start idle-ish clip once available.
    const idle = idleName ? actions[idleName] : null;
    const locomotion = locomotionName ? actions[locomotionName] : null;
    const single = singleName ? actions[singleName] : null;
    const first = idle ?? locomotion ?? single;
    if (!first) return;
    first.reset().fadeIn(0.2).play();
    activeRef.current = first;
    return () => {
      try {
        first.fadeOut(0.15);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, idleName, locomotionName, singleName]);

  useFrame((_state, dt) => {
    mixer.update(dt);

    const idle = idleName ? actions[idleName] : null;
    const locomotion = locomotionName ? actions[locomotionName] : null;
    const single = singleName ? actions[singleName] : null;

    if (single && !idle && !locomotion) {
      const wantMove = moveAmountRef.current > 0.08;
      single.enabled = true;
      single.paused = false;
      // Cheap PS2-ish feel: one clip, two "modes" via timeScale (faster when "running").
      const targetTs = wantMove ? 1.45 * LOCOMOTION_TIME_SCALE : 0.35;
      single.timeScale = THREE.MathUtils.lerp(
        single.timeScale,
        targetTs,
        1 - Math.exp(-dt * 10),
      );
      if (!single.isRunning()) single.play();
      activeRef.current = single;
    } else if (idle || locomotion) {
      const wantMove = moveAmountRef.current > 0.08;
      const desired = wantMove ? (locomotion ?? idle) : (idle ?? locomotion);
      if (!desired) return;

      if (activeRef.current && activeRef.current !== desired) {
        desired.reset();
        desired.crossFadeFrom(activeRef.current, 0.18, false);
        desired.play();
        activeRef.current = desired;
      } else if (!activeRef.current) {
        desired.reset().fadeIn(0.15).play();
        activeRef.current = desired;
      }

      if (locomotion) {
        locomotion.timeScale = wantMove ? LOCOMOTION_TIME_SCALE : 1;
      }
      if (idle) idle.timeScale = 1;
    }

    // Face movement direction: model forward is +Z in most glTF; tune if needed.
    if (groupRef.current) {
      const yaw = useCameraYaw ? yawRef.current : serverYawRef.current;
      groupRef.current.rotation.y = yaw + MODEL_YAW_OFFSET;
      const x = viewRef.current.x;
      const z = viewRef.current.z;
      const gy = heightAt(x, z, { seed: terrainSeed });
      // Place feet on terrain: footY is the model-space min Y of the scaled rig.
      groupRef.current.position.set(x, gy - normalized.footY, z);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={clone} />
      <Html
        position={[0, normalized.headY + 0.08, 0]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            color: "rgba(255,255,255,0.92)",
            fontSize: "12px",
            textShadow: "0 2px 10px rgba(0,0,0,0.85)",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
      </Html>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
