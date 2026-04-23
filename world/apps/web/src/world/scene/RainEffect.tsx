import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const DROP_COUNT = 9000;
/** Horizontal half-extent of the rain volume (m), centered on the camera. */
const BOX_XZ = 42;
/** Top / bottom of drops in local space (m) relative to camera. */
const Y_TOP = 32;
const Y_BOTTOM = -14;

/** Soft radial sprite — Gaussian-ish falloff so points read as blurred drops, not hard squares. */
function createRainSpriteTexture(): THREE.CanvasTexture {
  const res = 64;
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("RainEffect: canvas 2d context unavailable");
  }
  const img = ctx.createImageData(res, res);
  const d = img.data;
  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const u = (px + 0.5) / res - 0.5;
      const v = (py + 0.5) / res - 0.5;
      const r = Math.hypot(u, v) * 2;
      const a = Math.exp(-r * r * 6.2);
      const j = (py * res + px) * 4;
      d[j] = 255;
      d[j + 1] = 255;
      d[j + 2] = 255;
      d[j + 3] = Math.floor(THREE.MathUtils.clamp(a * 255, 0, 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Lightweight screen-space rain: follows the camera, animates in a local volume.
 * Intended to read as ambient weather without heavy GPU cost.
 */
export function RainEffect() {
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const speedsRef = useRef<Float32Array | null>(null);

  const geometry = useMemo(() => {
    const positions = new Float32Array(DROP_COUNT * 3);
    const speeds = new Float32Array(DROP_COUNT);
    speedsRef.current = speeds;
    for (let i = 0; i < DROP_COUNT; i++) {
      const ix = i * 3;
      positions[ix] = (Math.random() - 0.5) * 2 * BOX_XZ;
      positions[ix + 1] = Math.random() * (Y_TOP - Y_BOTTOM) + Y_BOTTOM;
      positions[ix + 2] = (Math.random() - 0.5) * 2 * BOX_XZ;
      speeds[i] = 20 + Math.random() * 32;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  const windXZ = useMemo(
    () => new THREE.Vector2(0.55, -0.22),
    [],
  );

  const spriteMap = useMemo(() => createRainSpriteTexture(), []);
  useEffect(() => {
    return () => {
      spriteMap.dispose();
    };
  }, [spriteMap]);

  useFrame((_, dt) => {
    const pts = pointsRef.current;
    const speeds = speedsRef.current;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!pts || !speeds || !posAttr) return;

    pts.position.copy(camera.position);

    const arr = posAttr.array as Float32Array;
    const wmix = dt * 12;
    for (let i = 0; i < DROP_COUNT; i++) {
      const ix = i * 3;
      const sp = speeds[i]!;
      arr[ix] = arr[ix]! + windXZ.x * wmix * (0.35 + sp * 0.012);
      arr[ix + 1] = arr[ix + 1]! - sp * dt;
      arr[ix + 2] = arr[ix + 2]! + windXZ.y * wmix * (0.35 + sp * 0.012);
      if (arr[ix + 1]! < Y_BOTTOM) {
        arr[ix + 1] = Y_TOP + Math.random() * 10;
        arr[ix] = (Math.random() - 0.5) * 2 * BOX_XZ;
        arr[ix + 2] = (Math.random() - 0.5) * 2 * BOX_XZ;
      }
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={spriteMap}
        alphaTest={0.02}
        color="#d2e0ff"
        size={0.2}
        transparent
        opacity={0.52}
        depthWrite={false}
        sizeAttenuation
        fog
      />
    </points>
  );
}
