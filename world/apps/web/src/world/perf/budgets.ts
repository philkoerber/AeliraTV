/**
 * Stop/go targets for the world client. True GPU VRAM is not exposed in the browser;
 * use `renderer.info.memory` counts only as a coarse proxy (textures/geometries).
 */
export const PERF_BUDGETS = {
  /** Draw calls: comfortable band (green → amber near upper end). */
  drawCallsComfort: 400,
  drawCallsWarn: 700,
  /** Beyond this, treat as hard pressure (red). */
  drawCallsHard: 1000,

  /** Rolling p95 frame time (ms) at ~60fps budget. */
  frameMsP95Comfort: 18,
  frameMsP95Warn: 26,

  /** Placeholder until real chunking; used for HUD + future gating. */
  maxSimultaneousChunks: 9,

  /** Memory proxy: geometry + texture counts from three.js info.memory. */
  geometriesWarn: 400,
  texturesWarn: 120
} as const;

export type BudgetStatus = "ok" | "warn" | "bad";

export function budgetForDrawCalls(calls: number): BudgetStatus {
  if (calls >= PERF_BUDGETS.drawCallsHard) return "bad";
  if (calls >= PERF_BUDGETS.drawCallsWarn) return "warn";
  return "ok";
}

export function budgetForFrameP95(p95Ms: number): BudgetStatus {
  if (!Number.isFinite(p95Ms)) return "ok";
  if (p95Ms >= PERF_BUDGETS.frameMsP95Warn) return "bad";
  if (p95Ms >= PERF_BUDGETS.frameMsP95Comfort) return "warn";
  return "ok";
}

export function budgetForMemoryProxy(geometries: number, textures: number): BudgetStatus {
  if (geometries >= PERF_BUDGETS.geometriesWarn || textures >= PERF_BUDGETS.texturesWarn) return "warn";
  return "ok";
}
