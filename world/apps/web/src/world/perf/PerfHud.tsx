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

function fmtCoord(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
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
      <div className={`perfHudRow ${statusClass(frameBudget)}`}>
        <span className="perfHudLabel">frame</span>
        <span className="perfHudValue">
          p50/p95 {fmt(p.p50FrameMs)} / {fmt(p.p95FrameMs)} ms · inst {fmt(p.fpsInstant, 0)} fps
        </span>
      </div>
      <div className="perfHudRow perfHudMuted">
        <span className="perfHudLabel">pos</span>
        <span className="perfHudValue">
          {fmtCoord(p.camX)} / {fmtCoord(p.camY)} / {fmtCoord(p.camZ)}
        </span>
      </div>
      <div className={`perfHudRow ${statusClass(drawBudget)}`}>
        <span className="perfHudLabel">draws</span>
        <span className="perfHudValue">
          {p.drawCalls} / ~{PERF_BUDGETS.drawCallsComfort}–{PERF_BUDGETS.drawCallsHard} · tris {p.triangles}
        </span>
      </div>
      <div className={`perfHudRow ${statusClass(p.memoryStatus)}`}>
        <span className="perfHudLabel">mem</span>
        <span className="perfHudValue">
          proxy geo/tex {p.geometries} / {p.textures}
        </span>
      </div>
      <div className="perfHudRow perfHudMuted">
        <span className="perfHudLabel">chunks</span>
        <span className="perfHudValue">
          loaded {p.loadedChunks} · build {fmt(p.lastChunkBuildMs, 2)} ms · swap {fmt(p.lastChunkSwapMs, 2)} ms ·
          evict {p.chunkEvictionsTotal}
        </span>
      </div>
      <div className="perfHudRow perfHudMuted">
        <span className="perfHudLabel">decor</span>
        <span className="perfHudValue">
          inst {p.propsInstanceTotal} · mtx {fmt(p.propsLastMatrixBuildMs, 2)} ms · merge {fmt(p.propsLastMergeMs, 2)}{" "}
          ms · clamp {p.propsMergeClampHits}
        </span>
      </div>
      <div className="perfHudRow perfHudMuted">
        <span className="perfHudLabel">net</span>
        <span className="perfHudValue">
          patches/s {p.statePatchesPerSec} · out {p.outgoingSendsPerSec} msg/s · out {p.outgoingBytesPerSec} B/s · in{" "}
          {p.incomingWsBytesPerSec} B/s{!p.incomingWsHooked ? " (in-hook off)" : ""}
        </span>
      </div>
    </div>
  );
}
