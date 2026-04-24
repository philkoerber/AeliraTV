import React, { useEffect, useState } from "react";
import { PERF_BUDGETS, budgetForDrawCalls, budgetForFrameP95 } from "./budgets.js";
import { perfSnapshot } from "./perfStore.js";

const HUD_HZ = 4;
const INTERVAL_MS = Math.round(1000 / HUD_HZ);

function statusClass(status: string): string {
  if (status === "bad") return "perfHudBad";
  if (status === "warn") return "perfHudWarn";
  return "perfHudOk";
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export function PerfHud(): React.ReactElement {
  const [, bump] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => bump((x) => x + 1), INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const p = perfSnapshot;
  const drawBudget = budgetForDrawCalls(p.drawCalls);
  const frameBudget = budgetForFrameP95(p.p95FrameMs);

  return (
    <div className="perfHud" data-testid="world-perf-hud" aria-label="Performance HUD">
      <div className="perfHudTitle">World perf</div>
      <div className={statusClass(frameBudget)}>
        frame p50/p95: {fmt(p.p50FrameMs)} / {fmt(p.p95FrameMs)} ms · inst {fmt(p.fpsInstant, 0)} fps
      </div>
      <div className={statusClass(drawBudget)}>
        draws {p.drawCalls} / ~{PERF_BUDGETS.drawCallsComfort}–{PERF_BUDGETS.drawCallsHard} · tris {p.triangles}
      </div>
      <div className={statusClass(p.memoryStatus)}>
        mem proxy geo/tex {p.geometries} / {p.textures}
      </div>
      <div className="perfHudMuted">
        chunks: loaded {p.loadedChunks} · build {fmt(p.lastChunkBuildMs, 2)} ms · swap{" "}
        {fmt(p.lastChunkSwapMs, 2)} ms · evict {p.chunkEvictionsTotal}
      </div>
      <div className="perfHudMuted">
        net: patches/s {p.statePatchesPerSec} · out {p.outgoingSendsPerSec} msg/s · out{" "}
        {p.outgoingBytesPerSec} B/s · in {p.incomingWsBytesPerSec} B/s
        {!p.incomingWsHooked ? " (in-hook off)" : ""}
      </div>
    </div>
  );
}
