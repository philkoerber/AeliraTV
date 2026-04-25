import type { DecorInstance, DecorOverrides } from "@aeliratv/shared-world";

/**
 * Optional Colyseus message payload for hybrid decor authority.
 * Server can push small exclusion / forced-placement overlays; clients merge
 * into `generateChunkDecor` via a ref (see `ChunkPropsCoordinator`).
 */
export type DecorOverlayMessageV1 = {
  v: 1;
  /** Bump when overlay content changes (client should rebuild decor). */
  revision: number;
  excludeCircles?: Array<{ x: number; z: number; r: number }>;
  forceInstances?: Array<Omit<DecorInstance, "biomeMix">>;
};

export function decorOverridesFromOverlayMessage(
  msg: DecorOverlayMessageV1,
): DecorOverrides {
  return {
    excludeCircles: msg.excludeCircles,
    forceInstances: msg.forceInstances,
  };
}
