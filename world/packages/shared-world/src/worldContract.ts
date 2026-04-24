import type { TerrainConfig } from "./terrain.js";
import { DEFAULT_CHUNK_SIZE, GENERATOR_BUILD, RULESET_VERSION } from "./versions.js";

/** Immutable-for-session fields the server owns; everything that affects recomputation is versioned. */
export type WorldContractFields = {
  worldSeed: string;
  rulesetVersion: number;
  generatorBuild: number;
  chunkSize: number;
  persistentDeltaVersion: number;
  /** Placeholder LOD tier id for future profiles. */
  lodProfileId: number;
};

export function defaultWorldContract(worldSeed: string): WorldContractFields {
  return {
    worldSeed,
    rulesetVersion: RULESET_VERSION,
    generatorBuild: GENERATOR_BUILD,
    chunkSize: DEFAULT_CHUNK_SIZE,
    persistentDeltaVersion: 0,
    lodProfileId: 0
  };
}

/** Same terrain tuning everywhere until ruleset splits macro/detail presets. */
export function terrainConfigFromContract(fields: Pick<WorldContractFields, "worldSeed">): TerrainConfig {
  return { seed: fields.worldSeed };
}
