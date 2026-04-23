import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { chunkKey, heightAt } from "@aeliratv/shared-world";
import { joinWorld } from "./net.js";

type Props = {
  name: string;
  endpoint: string;
};

export function Game({ name, endpoint }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // React 18 StrictMode (dev) mounts effects twice; guard async join so we don't keep two rooms/sessions alive.
  const joinGenerationRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const effectId = ++joinGenerationRef.current;

    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sky = new THREE.Color("#bfe7ff");
    renderer.setClearColor(sky, 1);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = "none";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = sky;
    // Match fog to sky so distant terrain blends into a blue horizon.
    scene.fog = new THREE.FogExp2(sky, 0.018);

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 600);
    camera.position.set(0, 6, 10);

    const hemi = new THREE.HemisphereLight(0xd7e3ff, 0x101622, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
    sun.position.set(55, 85, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.06;
    scene.add(sun);
    scene.add(sun.target);

    // Materials: PS2-ish flat shading.
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3a5b45,
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    const selfMat = new THREE.MeshStandardMaterial({ color: 0x7aa2ff, roughness: 1, flatShading: true });
    const otherMat = new THREE.MeshStandardMaterial({ color: 0xffb86b, roughness: 1, flatShading: true });
    const dressMat = new THREE.MeshStandardMaterial({ color: 0x6b4b7a, roughness: 1, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd6b89a, roughness: 1, flatShading: true });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1f33, roughness: 1, flatShading: true });

    // Terrain chunks.
    const chunkSize = 32;
    const segments = 20;
    const chunkRadius = 3;
    const terrain = new Map<string, THREE.Mesh>();

    function ensureTerrainAround(px: number, pz: number) {
      const ccx = Math.floor(px / chunkSize);
      const ccz = Math.floor(pz / chunkSize);

      for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
        for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
          const cx = ccx + dx;
          const cz = ccz + dz;
          const key = chunkKey(cx, cz);
          if (terrain.has(key)) continue;

          const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
          geo.rotateX(-Math.PI / 2);

          const pos = geo.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const vx = pos.getX(i) + cx * chunkSize;
            const vz = pos.getZ(i) + cz * chunkSize;
            const y = heightAt(vx, vz, { seed: 1337 });
            pos.setY(i, y);
          }
          pos.needsUpdate = true;
          geo.computeVertexNormals();

          const mesh = new THREE.Mesh(geo, groundMat);
          mesh.position.set(cx * chunkSize, 0, cz * chunkSize);
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          scene.add(mesh);
          terrain.set(key, mesh);
        }
      }
    }

    // Ensure origin terrain exists before placing props on the ground.
    ensureTerrainAround(0, 0);
    const originGroundY = heightAt(0, 0, { seed: 1337 });

    // Placeholder "piano girl" at origin.
    const centerGroup = new THREE.Group();
    centerGroup.position.set(0, originGroundY, 0);
    // Intentionally NOT a capsule (players are capsules) to avoid "duplicate character" confusion.
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
    const piano = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.9), new THREE.MeshStandardMaterial({ color: 0x1d1f28, roughness: 0.9, flatShading: true }));
    piano.position.set(0.2, 0.5, -0.9);
    piano.castShadow = true;
    piano.receiveShadow = true;
    centerGroup.add(torso, head, hair, piano);
    scene.add(centerGroup);

    // Aim the sun at the origin-ish area for stable shadows around the centerpiece.
    sun.target.position.set(0, originGroundY + 1, 0);
    sun.target.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();

    // Player visuals + smoothing/prediction.
    type PlayerVisual = {
      mesh: THREE.Mesh;
      label: HTMLDivElement;
      renderPos: THREE.Vector3;
      renderY: number;
      serverPos: THREE.Vector3;
      serverYaw: number;
    };
    const players = new Map<string, PlayerVisual>();
    const labelLayer = document.createElement("div");
    labelLayer.style.position = "absolute";
    labelLayer.style.inset = "0";
    labelLayer.style.pointerEvents = "none";
    mount.style.position = "relative";
    mount.appendChild(labelLayer);

    function makeLabel(text: string) {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.position = "absolute";
      el.style.transform = "translate(-50%, -50%)";
      el.style.color = "rgba(255,255,255,0.9)";
      el.style.fontSize = "12px";
      el.style.textShadow = "0 2px 8px rgba(0,0,0,0.8)";
      el.style.whiteSpace = "nowrap";
      labelLayer.appendChild(el);
      return el;
    }

    const avatarGeo = new THREE.CapsuleGeometry(0.4, 1.1, 2, 6);
    const avatarRadius = avatarGeo.parameters.radius;
    const avatarLength = avatarGeo.parameters.length;
    const avatarHalfHeight = avatarRadius + avatarLength * 0.5;
    const avatarTotalHeight = avatarRadius * 2 + avatarLength;

    // Input state.
    const keys = new Set<string>();
    let yaw = 0;
    let pointerLocked = false;

    function onKeyDown(e: KeyboardEvent) {
      keys.add(e.code);
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.delete(e.code);
    }
    function onMouseMove(e: MouseEvent) {
      if (!pointerLocked) return;
      yaw -= e.movementX * 0.0026;
    }
    function onClick() {
      renderer.domElement.focus();
      renderer.domElement.requestPointerLock();
    }
    function onPointerLockChange() {
      pointerLocked = document.pointerLockElement === renderer.domElement;
    }

    // Some environments require the canvas to be focused to receive keyboard input.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    renderer.domElement.addEventListener("keydown", onKeyDown);
    renderer.domElement.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    renderer.domElement.addEventListener("click", onClick);

    const selfIdRef = { current: "" };
    let lastSelfX = 0;
    let lastSelfZ = 0;
    const tmpVec = new THREE.Vector3();
    const tmpVec2 = new THREE.Vector3();

    function ensurePlayer(id: string, displayName: string): PlayerVisual {
      let entry = players.get(id);
      if (!entry) {
        const mat = id === selfIdRef.current ? selfMat : otherMat;
        const mesh = new THREE.Mesh(avatarGeo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const label = makeLabel(displayName);
        entry = {
          mesh,
          label,
          renderPos: new THREE.Vector3(0, 0, 0),
          renderY: 0,
          serverPos: new THREE.Vector3(0, 0, 0),
          serverYaw: 0
        };
        players.set(id, entry);
      } else if (entry.label.textContent !== displayName) {
        entry.label.textContent = displayName;
      }
      return entry;
    }

    function removePlayer(id: string) {
      const entry = players.get(id);
      if (!entry) return;
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      // materials are shared; do not dispose
      entry.label.remove();
      players.delete(id);
    }

    function shortestAngleDelta(from: number, to: number): number {
      return Math.atan2(Math.sin(to - from), Math.cos(to - from));
    }

    let room: any = null;
    let raf = 0;
    let lastSend = 0;
    let lastFrameT = performance.now();

    (async () => {
      const joinedRoom = await joinWorld(endpoint, name);

      // If this effect was torn down (StrictMode) or superseded by a newer effect, leave immediately.
      if (disposed || joinGenerationRef.current !== effectId) {
        try {
          joinedRoom?.leave?.();
        } catch {
          // ignore
        }
        return;
      }

      room = joinedRoom;
      selfIdRef.current = room.sessionId;

      const loop = (t: number) => {
        if (disposed || joinGenerationRef.current !== effectId) return;
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, Math.max(0, (t - lastFrameT) / 1000));
        lastFrameT = t;

        const forward = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
        const right = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);

        // Send input ~60Hz (matches server tick; reduces stepping when holding keys).
        if (room && t - lastSend > 16) {
          lastSend = t;
          room.send("input", { forward, right, yaw });
        }

        // Robust state sync: pull authoritative positions from Colyseus state each frame.
        const seen = new Set<string>();
        if (room?.state?.players) {
          room.state.players.forEach((player: any, key: string) => {
            seen.add(key);
            const entry = ensurePlayer(key, String(player.name ?? "Player"));
            entry.serverPos.set(player.x, 0, player.z);
            entry.serverYaw = player.yaw;

            // First time we see a player, snap render to server.
            if (!entry.mesh.userData.__initialized) {
              entry.renderPos.copy(entry.serverPos);
              entry.renderY = heightAt(entry.renderPos.x, entry.renderPos.z, { seed: 1337 });
              entry.mesh.userData.__initialized = true;
            }
          });
        }

        // Only prune once we're actually connected to a room with a state map.
        if (room?.state?.players) {
          for (const id of players.keys()) {
            if (!seen.has(id)) removePlayer(id);
          }
        }

        // Local prediction + smoothing toward server for self; interpolation for others.
        const moveSpeed = 6;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const predDx = (sin * forward - cos * right) * moveSpeed * dt;
        const predDz = (cos * forward + sin * right) * moveSpeed * dt;

        for (const [id, entry] of players.entries()) {
          if (id === selfIdRef.current) {
            entry.renderPos.x += predDx;
            entry.renderPos.z += predDz;

            // Softly reconcile to authoritative server position (hides network stepping).
            entry.renderPos.lerp(entry.serverPos, 0.14);

            const curYaw = entry.mesh.rotation.y;
            const targetYaw = yaw;
            entry.mesh.rotation.y = curYaw + shortestAngleDelta(curYaw, targetYaw) * 0.35;
          } else {
            entry.renderPos.lerp(entry.serverPos, 0.18);

            const curYaw = entry.mesh.rotation.y;
            const targetYaw = entry.serverYaw;
            entry.mesh.rotation.y = curYaw + shortestAngleDelta(curYaw, targetYaw) * 0.28;
          }

          const groundY = heightAt(entry.renderPos.x, entry.renderPos.z, { seed: 1337 });
          const yAlpha = 1 - Math.exp(-dt * 18);
          entry.renderY = THREE.MathUtils.lerp(entry.renderY, groundY, yAlpha);
          // `renderY` is "feet on terrain" height; capsule geometry is centered, so lift by half-height.
          entry.mesh.position.set(entry.renderPos.x, entry.renderY + avatarHalfHeight, entry.renderPos.z);

          // place label above head (use grounded Y)
          tmpVec.set(entry.renderPos.x, entry.renderY + avatarTotalHeight + 0.12, entry.renderPos.z).project(camera);
          const sx = (tmpVec.x * 0.5 + 0.5) * mount.clientWidth;
          const sy = (-tmpVec.y * 0.5 + 0.5) * mount.clientHeight;
          entry.label.style.left = `${sx}px`;
          entry.label.style.top = `${sy}px`;
          entry.label.style.opacity = tmpVec.z < 1 ? "1" : "0";
        }

        // Camera follow self (read last known self state from meshes).
        const selfEntry = players.get(selfIdRef.current);
        if (selfEntry) {
          lastSelfX = selfEntry.renderPos.x;
          lastSelfZ = selfEntry.renderPos.z;
        }

        ensureTerrainAround(lastSelfX, lastSelfZ);

        const selfFootY = selfEntry ? selfEntry.renderY : heightAt(lastSelfX, lastSelfZ, { seed: 1337 });
        const target = tmpVec.set(lastSelfX, selfFootY + avatarHalfHeight, lastSelfZ);
        const behind = tmpVec2.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const camPos = new THREE.Vector3(
          target.x - behind.x * 8,
          target.y + 5.2,
          target.z - behind.z * 8
        );
        camera.position.lerp(camPos, 0.12);
        camera.lookAt(target);

        renderer.render(scene, camera);
      };

      raf = requestAnimationFrame(loop);
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
    });

    function onResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();

      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      renderer.domElement.removeEventListener("click", onClick);

      try {
        room?.leave?.();
      } catch {
        // ignore
      }

      for (const id of [...players.keys()]) removePlayer(id);
      for (const mesh of terrain.values()) {
        scene.remove(mesh);
        (mesh.geometry as THREE.BufferGeometry).dispose();
      }
      terrain.clear();

      scene.remove(centerGroup);
      centerGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        const geo = m.geometry as THREE.BufferGeometry | undefined;
        if (geo) geo.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat.dispose();
      });

      scene.remove(hemi);
      hemi.dispose();
      scene.remove(sun);
      sun.dispose();
      scene.remove(sun.target);

      groundMat.dispose();

      renderer.dispose();
      labelLayer.remove();
      renderer.domElement.remove();
    };
  }, [endpoint, name]);

  return <div ref={mountRef} style={{ height: "100%" }} />;
}

