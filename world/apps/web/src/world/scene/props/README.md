# Chunk props (vegetation / rocks)

This folder implements the **biome-based decor pipeline**: deterministic placement in `@aeliratv/shared-world`, chunk-scoped matrix builds on the client, merged instancing for draw-call control, and **dual-map LOD** (256 vs 512 atlases) with per-instance blend + chunk-ring fade.

## Data flow

1. **`ChunkPropsCoordinator`** (`ChunkPropsCoordinator.tsx`)
   - Tracks the same chunk window as terrain (`CHUNK_PRELOAD_RADIUS`).
   - For each loaded chunk with a `ChunkHeightField`, runs `generateChunkDecor` from shared-world (seed + `generatorBuild` + optional `DecorOverrides`).
   - Writes instance **matrices** snapped to `meshHeightAtXZ` into `ChunkPropsBuildsHandle` (ref).

2. **`ChunkPropsRenderer`** (`ChunkPropsRenderer.tsx`)
   - Suspends on `useTexture` / `useFBX` loads.
   - Merges all chunk layers **per asset** (`mergeDecorInstances.ts`) into GPU-friendly instanced draws.
   - Per frame updates `aLodBlend` so **near textures** dominate close to the local player; preload-ring chunks keep `lodBlend ≈ 0` (far atlas only) and use the same **0.22** visibility multiplier as terrain’s preload ring.

3. **`DecorMergedInstancing`** (`DecorMergedInstancing.tsx`)
   - One `InstancedMesh` per asset (`meadow_plants`, `bushes`, `rocks`) with a **custom `MeshStandardMaterial`** (`decorInstancedMaterial.ts`) that mixes far/near albedo maps in the fragment shader.

4. **Asset registry** (`assetRegistry.ts`)
   - Authoritative list of FBX + texture URLs, LOD tiers, material defaults, and `worldGeometryScale` (kits often need a uniform shrink). The merged `Rocks.fbx` was ~130m radius at 1.0; rocks use `0.01` so instances are walkable scale (~1.3m).

## Hybrid overrides (server / authored)

- Shared type: `DecorOverrides` in `@aeliratv/shared-world` (`decor.ts`).
- Client hook: optional `decorOverridesRef` passed into `ChunkPropsCoordinator` (see `WorldCanvas.tsx`).
- Message schema (v1): `decor_overlay` payload in `decorOverlay.ts`. Server can push `{ v:1, revision, excludeCircles?, forceInstances? }` and the client will rebuild affected chunks (build key includes a stable JSON fingerprint of overrides).

## Performance counters

`chunkMetricsBridge.ts` reports:

- `propsLastMatrixBuildMs` — worst per-chunk CPU time rebuilding matrices in the coordinator.
- `propsLastMergeMs` — worst per-asset merge + attribute upload pass.
- `propsInstanceTotal` — sum of instance counts currently published in the builds handle.
- `propsMergeClampHits` — instances dropped because an asset exceeded its instancing cap.

These surface in `PerfHud` under **decor**.

## Adding a new kit

1. Drop assets under `public/vegetation` or `public/rocks`.
2. Add a `PropSetId` + `PROP_SETS[...]` entry (far + near LOD texture URLs, FBX URL, `worldGeometryScale`).
3. Extend `DecorAssetId` + `generateChunkDecor` in `packages/shared-world/src/decor.ts` to emit placements for the new id.
4. Add the id to `ASSET_ORDER` in `ChunkPropsRenderer.tsx` and `ChunkPropsCoordinator.tsx` (matrix layer ordering).
