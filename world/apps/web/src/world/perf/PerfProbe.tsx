import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { budgetForDrawCalls, budgetForFrameP95, budgetForMemoryProxy } from "./budgets.js";
import { resetChunkMetrics } from "./chunkMetricsBridge.js";
import { perfSnapshot } from "./perfStore.js";
import { FrameTimeRingBuffer } from "./rollingPercentiles.js";

const RING_CAP = 180;

export function PerfProbe(): null {
  const ringRef = useRef<FrameTimeRingBuffer | null>(null);
  const { gl, clock } = useThree();

  useEffect(() => {
    ringRef.current = new FrameTimeRingBuffer(RING_CAP);
    resetChunkMetrics();
  }, []);

  useFrame(() => {
    const ring = ringRef.current;
    if (!ring) return;

    const dt = clock.getDelta();
    const ms = dt * 1000;
    ring.push(ms);
    const { p50Ms, p95Ms, count } = ring.percentiles();

    const info = gl.info.render;
    const mem = gl.info.memory;

    perfSnapshot.lastFrameMs = ms;
    perfSnapshot.p50FrameMs = p50Ms;
    perfSnapshot.p95FrameMs = p95Ms;
    perfSnapshot.frameSamples = count;
    perfSnapshot.fpsInstant = ms > 1e-6 ? 1000 / ms : 0;
    perfSnapshot.drawCalls = info.calls;
    perfSnapshot.triangles = info.triangles;
    perfSnapshot.points = info.points;
    perfSnapshot.lines = info.lines;
    perfSnapshot.geometries = mem.geometries;
    perfSnapshot.textures = mem.textures;

    perfSnapshot.drawStatus = budgetForDrawCalls(info.calls);
    perfSnapshot.frameStatus = budgetForFrameP95(p95Ms);
    perfSnapshot.memoryStatus = budgetForMemoryProxy(mem.geometries, mem.textures);
  });

  return null;
}
