import { describe, expect, it } from "vitest";
import { FrameTimeRingBuffer, linearPercentile, percentilesFromSamples } from "./rollingPercentiles.js";

describe("linearPercentile", () => {
  it("interpolates median of two", () => {
    expect(linearPercentile([10, 20], 0.5)).toBe(15);
  });

  it("returns single element", () => {
    expect(linearPercentile([7], 0.5)).toBe(7);
    expect(linearPercentile([7], 0.95)).toBe(7);
  });

  it("handles p95 span", () => {
    const s = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(linearPercentile(s, 0.95)).toBeGreaterThan(90);
  });
});

describe("percentilesFromSamples", () => {
  it("returns NaNs for empty", () => {
    const r = percentilesFromSamples([]);
    expect(r.count).toBe(0);
    expect(Number.isNaN(r.p50Ms)).toBe(true);
  });
});

describe("FrameTimeRingBuffer", () => {
  it("caps length and still yields sensible p50", () => {
    const ring = new FrameTimeRingBuffer(4);
    ring.push(10);
    ring.push(20);
    ring.push(30);
    ring.push(40);
    ring.push(50);
    const { p50Ms, count } = ring.percentiles();
    expect(count).toBe(4);
    expect(p50Ms).toBeGreaterThan(0);
  });
});
