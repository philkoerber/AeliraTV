import type { MeshStandardMaterial, Texture } from "three";

export type GroundShaderPatchOptions = {
  /** World-space detail multiply; independent repeat from terrain mesh UVs. */
  detailMap?: Texture | null;
};

export function patchGroundMeshStandardMaterial(
  material: MeshStandardMaterial,
  options?: GroundShaderPatchOptions,
): void;
