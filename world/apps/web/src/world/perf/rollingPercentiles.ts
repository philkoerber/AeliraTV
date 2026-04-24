/**
 * Rolling window stats for frame times (ms). Copy-on-read for percentiles; O(n log n) per call, n <= cap (~240).
 */

export type PercentileResult = {
  p50Ms: number;
  p95Ms: number;
  count: number;
};

export function linearPercentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const clampedP = Math.min(1, Math.max(0, p));
  const pos = clampedP * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sortedAsc[lo]!;
  const b = sortedAsc[hi]!;
  if (lo === hi) return a;
  return a + (b - a) * (pos - lo);
}

export function percentilesFromSamples(samples: readonly number[]): PercentileResult {
  if (samples.length === 0) {
    return { p50Ms: Number.NaN, p95Ms: Number.NaN, count: 0 };
  }
  const sorted = [...samples].sort((x, y) => x - y);
  return {
    p50Ms: linearPercentile(sorted, 0.5),
    p95Ms: linearPercentile(sorted, 0.95),
    count: samples.length
  };
}

export class FrameTimeRingBuffer {
  private readonly cap: number;
  private readonly buf: Float32Array;
  private write = 0;
  private filled = 0;

  constructor(capacity: number) {
    this.cap = Math.max(1, capacity);
    this.buf = new Float32Array(this.cap);
  }

  push(ms: number): void {
    this.buf[this.write] = ms;
    this.write = (this.write + 1) % this.cap;
    this.filled = Math.min(this.filled + 1, this.cap);
  }

  /** Copy of valid samples (oldest → newest not guaranteed; order irrelevant for percentiles). */
  values(): number[] {
    const n = this.filled;
    const out: number[] = new Array(n);
    if (n < this.cap) {
      for (let i = 0; i < n; i++) out[i] = this.buf[i]!;
    } else {
      const start = this.write;
      for (let i = 0; i < n; i++) out[i] = this.buf[(start + i) % this.cap]!;
    }
    return out;
  }

  percentiles(): PercentileResult {
    return percentilesFromSamples(this.values());
  }
}
