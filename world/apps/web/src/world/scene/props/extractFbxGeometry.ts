import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Bake mesh transforms into geometry clones and merge for instancing.
 * Caller owns the returned geometry (dispose when no longer used).
 */
export function bufferGeometryFromFbxRoot(root: THREE.Object3D): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  if (parts.length === 0) {
    throw new Error("No mesh geometry found in FBX root");
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return mergeGeometries(parts, false);
}
