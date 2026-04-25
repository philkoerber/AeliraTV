export type BiomeId = "Meadow" | "Forest";

export type PropCategory = "vegetation" | "rocks";

export type PropSetId = "meadow_plants" | "bushes" | "rocks";

export type PropLodTier = "near" | "far";

export type PropTextureSet = {
  albedoUrl: string;
  normalUrl?: string;
};

export type PropLodSpec = {
  tier: PropLodTier;
  /**
   * For now we keep a single geometry source; later we can add per-tier meshes
   * (e.g. low-poly / impostors).
   */
  fbxUrl: string;
  textures: PropTextureSet;
  /** Optional per-tier tuning (e.g. disable normal map in far tier). */
  material: {
    roughness: number;
    metalness: number;
    transparent?: boolean;
    alphaTest?: number;
    side?: "front" | "double";
  };
};

export type PropSetSpec = {
  id: PropSetId;
  category: PropCategory;
  /** World-space “density class” for budgets/shadows/LOD distances. */
  budgetClass: "tiny" | "medium" | "hero";
  /** Uniform scale applied to merged FBX geometry (many kits are authored in cm). */
  worldGeometryScale: number;
  lods: readonly PropLodSpec[];
  /** Which biomes this set is allowed to appear in. */
  allowedBiomes: readonly BiomeId[];
};

export const PROP_SETS: Record<PropSetId, PropSetSpec> = {
  meadow_plants: {
    id: "meadow_plants",
    category: "vegetation",
    budgetClass: "tiny",
    worldGeometryScale: 0.025,
    allowedBiomes: ["Meadow"],
    lods: [
      {
        tier: "far",
        fbxUrl: "/vegetation/MeadowPlants.fbx",
        textures: {
          // Use 380/512 flower atlas as “albedo”; future: split per-submesh.
          albedoUrl: "/vegetation/MeadowFlowers380.png",
        },
        material: {
          roughness: 0.95,
          metalness: 0.02,
          transparent: true,
          alphaTest: 0.5,
          side: "double",
        },
      },
      {
        tier: "near",
        fbxUrl: "/vegetation/MeadowPlants.fbx",
        textures: {
          albedoUrl: "/vegetation/MeadowFlowers512.png",
        },
        material: {
          roughness: 0.95,
          metalness: 0.02,
          transparent: true,
          alphaTest: 0.5,
          side: "double",
        },
      },
    ],
  },

  bushes: {
    id: "bushes",
    category: "vegetation",
    budgetClass: "medium",
    worldGeometryScale: 0.018,
    allowedBiomes: ["Forest", "Meadow"],
    lods: [
      {
        tier: "far",
        fbxUrl: "/vegetation/Bushes.fbx",
        textures: {
          albedoUrl: "/vegetation/BushesMaster256.png",
        },
        material: {
          roughness: 0.9,
          metalness: 0.03,
          transparent: true,
          alphaTest: 0.5,
          side: "double",
        },
      },
      {
        tier: "near",
        fbxUrl: "/vegetation/Bushes.fbx",
        textures: {
          albedoUrl: "/vegetation/BushesMaster512.png",
        },
        material: {
          roughness: 0.9,
          metalness: 0.03,
          transparent: true,
          alphaTest: 0.5,
          side: "double",
        },
      },
    ],
  },

  rocks: {
    id: "rocks",
    category: "rocks",
    budgetClass: "medium",
    /** FBX merges to ~130m radius at 1.0; scale to ~1.3m footprint for instancing. */
    worldGeometryScale: 0.01,
    allowedBiomes: ["Forest", "Meadow"],
    lods: [
      {
        tier: "far",
        fbxUrl: "/rocks/Rocks.fbx",
        textures: {
          albedoUrl: "/rocks/RockMaster_256.png",
          normalUrl: "/rocks/RockMasterNormal_256.png",
        },
        material: {
          roughness: 0.95,
          metalness: 0.02,
          side: "front",
        },
      },
      {
        tier: "near",
        fbxUrl: "/rocks/Rocks.fbx",
        textures: {
          albedoUrl: "/rocks/RockMaster_512.png",
          normalUrl: "/rocks/RockMasterNormal_512.png",
        },
        material: {
          roughness: 0.95,
          metalness: 0.02,
          side: "front",
        },
      },
    ],
  },
};

export function propSetLodSpec(
  setId: PropSetId,
  tier: PropLodTier,
): PropLodSpec {
  const set = PROP_SETS[setId];
  const spec = set.lods.find((l) => l.tier === tier);
  if (!spec) throw new Error(`Missing LOD tier ${tier} for prop set ${setId}`);
  return spec;
}

