/** Bump when terrain/biome/walk rules change; clients must invalidate caches. */
export const RULESET_VERSION = 1;

/** Bump when generator code or noise stack changes (independent of content rules). */
export const GENERATOR_BUILD = 1;

/** Default chunk grid step in world units (authoritative contract field). */
export const DEFAULT_CHUNK_SIZE = 64;
