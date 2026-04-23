import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { chunkKey, heightAt } from "@aeliratv/shared-world";
import { PlayerAvatar } from "./PlayerAvatar.js";

type Room = any;

type Props = {
  room: Room;
  displayName: string;
};

const TERRAIN_SEED = 1337;

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
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight(0xfff2d6, 1.05);
    l.position.set(55, 85, 25);
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.camera.near = 0.5;
    l.shadow.camera.far = 260;
    l.shadow.camera.left = -90;
    l.shadow.camera.right = 90;
    l.shadow.camera.top = 90;
    l.shadow.camera.bottom = -90;
    l.shadow.bias = -0.0008;
    l.shadow.normalBias = 0.06;
    return l;
  }, []);

  useEffect(() => {
    const originGroundY = heightAt(0, 0, { seed: TERRAIN_SEED });
    sun.target.position.set(0, originGroundY + 1.2, 0);
    sun.target.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
    return () => {
      sun.dispose();
    };
  }, [sun]);

  return (
    <>
      <hemisphereLight args={[0xd7e3ff, 0x101622, 0.55]} />
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
  const chunkSize = 32;
  const segments = 20;
  const chunkRadius = 3;

  const groundMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x3a5b45,
        roughness: 1,
        metalness: 0,
        flatShading: true
      }),
    []
  );

  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef<Map<string, THREE.Mesh>>(new Map());

  useFrame(({ camera }) => {
    const g = groupRef.current;
    if (!g) return;

    const px = camera.position.x;
    const pz = camera.position.z;
    const ccx = Math.floor(px / chunkSize);
    const ccz = Math.floor(pz / chunkSize);

    const want = new Set<string>();
    for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
      for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
        want.add(chunkKey(ccx + dx, ccz + dz));
      }
    }

    for (const [key, mesh] of chunksRef.current.entries()) {
      if (want.has(key)) continue;
      g.remove(mesh);
      (mesh.geometry as THREE.BufferGeometry).dispose();
      chunksRef.current.delete(key);
    }

    for (const key of want) {
      if (chunksRef.current.has(key)) continue;
      const parts = key.split(",");
      const sx = Number(parts[0]);
      const sz = Number(parts[1]);
      if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;

      const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i) + sx * chunkSize;
        const vz = pos.getZ(i) + sz * chunkSize;
        const y = heightAt(vx, vz, { seed: TERRAIN_SEED });
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, groundMat);
      mesh.position.set(sx * chunkSize, 0, sz * chunkSize);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      g.add(mesh);
      chunksRef.current.set(key, mesh);
    }
  });

  useEffect(() => {
    return () => {
      const g = groupRef.current;
      if (g) {
        for (const mesh of chunksRef.current.values()) {
          g.remove(mesh);
          (mesh.geometry as THREE.BufferGeometry).dispose();
        }
      }
      chunksRef.current.clear();
      groundMat.dispose();
    };
  }, [groundMat]);

  return <group ref={groupRef} />;
}

function Centerpiece() {
  const group = useMemo(() => new THREE.Group(), []);
  const dressMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x6b4b7a, roughness: 1, flatShading: true }),
    []
  );
  const skinMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0xd6b89a, roughness: 1, flatShading: true }),
    []
  );
  const hairMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x2a1f33, roughness: 1, flatShading: true }),
    []
  );
  const pianoMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x1d1f28, roughness: 0.9, flatShading: true }),
    []
  );

  useEffect(() => {
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.75, 8, 1), dressMat);
    torso.position.set(0, 1.05, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), skinMat);
    head.position.set(0, 1.52, 0);
    head.castShadow = true;
    head.receiveShadow = true;

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), hairMat);
    hair.position.set(0, 1.58, 0);
    hair.scale.set(1.05, 0.55, 1.05);
    hair.castShadow = true;
    hair.receiveShadow = true;

    const piano = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.9), pianoMat);
    piano.position.set(0.2, 0.5, -0.9);
    piano.castShadow = true;
    piano.receiveShadow = true;

    group.add(torso, head, hair, piano);

    // Ground the whole prop group using its bounding box (meshes are authored around y>0).
    const bb = new THREE.Box3().setFromObject(group);
    const originGroundY = heightAt(0, 0, { seed: TERRAIN_SEED });
    group.position.set(0, originGroundY - bb.min.y, 0);

    return () => {
      group.clear();
      torso.geometry.dispose();
      head.geometry.dispose();
      hair.geometry.dispose();
      piano.geometry.dispose();
      dressMat.dispose();
      skinMat.dispose();
      hairMat.dispose();
      pianoMat.dispose();
    };
  }, [dressMat, group, hairMat, pianoMat, skinMat]);

  return <primitive object={group} />;
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

    players.onAdd = (_p: any, key: string) => {
      const sp: SimPlayer = {
        id: key,
        name: String(_p.name ?? "Player"),
        server: new THREE.Vector3(_p.x, 0, _p.z),
        view: new THREE.Vector3(_p.x, 0, _p.z),
        yaw: _p.yaw,
        lastPos: new THREE.Vector3(_p.x, 0, _p.z),
        lastT: performance.now() / 1000,
        speed: 0,
        moveAmount: { current: 0 },
        viewRef: { current: new THREE.Vector3(_p.x, 0, _p.z) },
        serverYawRef: { current: _p.yaw }
      };
      simRef.current.set(key, sp);
      refreshIds();
    };

    players.onRemove = (_p: any, key: string) => {
      simRef.current.delete(key);
      refreshIds();
    };

    // Initial snapshot
    refreshIds();
    players.forEach((p: any, key: string) => {
      if (simRef.current.has(key)) return;
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
        serverYawRef: { current: p.yaw }
      };
      simRef.current.set(key, sp);
    });

    return () => {
      players.onAdd = undefined;
      players.onRemove = undefined;
    };
  }, [room]);

  useFrame((state) => {
    const dt = Math.min(0.05, state.clock.getDelta());
    const t = state.clock.elapsedTime * 1000;

    const forward = (keysRef.current.has("KeyW") ? 1 : 0) + (keysRef.current.has("KeyS") ? -1 : 0);
    const right = (keysRef.current.has("KeyD") ? 1 : 0) + (keysRef.current.has("KeyA") ? -1 : 0);

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
        sp.view.lerp(sp.server, 0.14);
        sp.moveAmount.current = Math.min(1, Math.abs(forward) + Math.abs(right));

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
      const behind = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRef.current);
      const camPos = new THREE.Vector3(target.x - behind.x * 8, target.y + 5.2, target.z - behind.z * 8);
      camera.position.lerp(camPos, 0.12);
      camera.lookAt(target);
    }
  });

  return (
    <>
      <PointerLock yawRef={yawRef} />
      <SunLights />
      <TerrainChunks />
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

export function WorldCanvas({ room, displayName }: Props) {
  const sky = useMemo(() => new THREE.Color("#bfe7ff"), []);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: false }}
      camera={{ fov: 60, near: 0.1, far: 600, position: [0, 6, 10] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(sky, 1);
        scene.background = sky;
        scene.fog = new THREE.FogExp2(sky, 0.018);
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <WorldRoot room={room} displayName={displayName} />
    </Canvas>
  );
}
