import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const HLS_URL = "/hls/stream.m3u8";
const STATE_URL = "/state";
const POLL_MS = 2000;

interface ServiceState {
  queue_depth: number | null;
  last_event_age_ms: number | null;
  hls_ready: boolean;
  last_heartbeat: {
    generated_through: number;
    playhead: number;
  } | null;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceCreated = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const [svcState, setSvcState] = useState<ServiceState | null>(null);
  const [hlsAttached, setHlsAttached] = useState(false);

  // ── Attach HLS.js ──────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        enableWorker: true,
      });
      hls.loadSource(HLS_URL);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setHlsAttached(true));
      return () => hls.destroy();
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = HLS_URL;
      setHlsAttached(true);
    }
  }, []);

  // ── Poll /state ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(STATE_URL);
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          setSvcState(data);
          setConnected(
            data.last_event_age_ms !== null && data.last_event_age_ms < 5000,
          );
        } catch {
          setConnected(false);
          setSvcState(null);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── VU meter via AnalyserNode ──────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !playing) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!sourceCreated.current) {
      const ac = new AudioContext();
      const source = ac.createMediaElementSource(audio);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ac.destination);
      analyserRef.current = analyser;
      sourceCreated.current = true;
    }

    const analyser = analyserRef.current;
    if (!analyser) return;

    const buf = new Float32Array(analyser.fftSize);
    let raf: number;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getFloatTimeDomainData(buf);

      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        sumSq += buf[i] * buf[i];
        peak = Math.max(peak, Math.abs(buf[i]));
      }
      const rms = Math.sqrt(sumSq / buf.length);

      const W = canvas.width;
      const H = canvas.height;
      const barH = H / 2 - 4;

      ctx.fillStyle = "#222230";
      ctx.fillRect(0, 0, W, H);

      // RMS bar
      const rmsW = Math.min(rms / 0.5, 1) * W;
      ctx.fillStyle = "#6c8cff";
      ctx.fillRect(0, 2, rmsW, barH);

      // Peak bar
      const peakW = Math.min(peak / 0.8, 1) * W;
      ctx.fillStyle = peak > 0.7 ? "#f87171" : "#34d399";
      ctx.fillRect(0, barH + 6, peakW, barH);

      // Labels
      ctx.fillStyle = "#888894";
      ctx.font = "10px monospace";
      ctx.fillText("RMS", 4, barH - 2);
      ctx.fillText("PEAK", 4, H - 4);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ── Play / Stop ────────────────────────────────────────────────
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true));
    }
  }, [playing]);

  // ── Render ─────────────────────────────────────────────────────
  const dot = connected ? "var(--green)" : "var(--red)";

  return (
    <div style={styles.card}>
      <h1 style={styles.title}>AeliraTV</h1>
      <p style={styles.subtitle}>Live AI Piano</p>

      {/* status row */}
      <div style={styles.statusRow}>
        <span
          style={{
            ...styles.dot,
            background: dot,
            boxShadow: connected ? "0 0 8px var(--green)" : "none",
          }}
        />
        <span style={styles.statusText}>
          {connected ? "AI connected" : "Waiting for AI service …"}
        </span>
      </div>

      {/* play button */}
      <button
        onClick={toggle}
        disabled={!hlsAttached}
        style={{
          ...styles.btn,
          opacity: hlsAttached ? 1 : 0.4,
        }}
      >
        {playing ? "■  Stop" : "▶  Play"}
      </button>

      {/* VU meter */}
      <canvas
        ref={canvasRef}
        width={400}
        height={48}
        style={styles.canvas}
      />

      {/* queue info */}
      {svcState && (
        <div style={styles.meta}>
          <span>Queue: {svcState.queue_depth ?? "–"}</span>
          {svcState.last_heartbeat && (
            <span>
              Generated: {svcState.last_heartbeat.generated_through.toFixed(1)}s
            </span>
          )}
          <span>HLS: {svcState.hls_ready ? "ready" : "waiting"}</span>
        </div>
      )}

      <audio ref={audioRef} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--surface)",
    borderRadius: 16,
    border: "1px solid var(--border)",
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    alignItems: "center",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    color: "var(--muted)",
    fontSize: "0.85rem",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  statusText: {
    fontSize: "0.8rem",
    color: "var(--muted)",
  },
  btn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0.65rem 2rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.04em",
    transition: "opacity 0.2s",
  },
  canvas: {
    width: "100%",
    height: 48,
    borderRadius: 6,
    background: "var(--meter-bg)",
  },
  meta: {
    display: "flex",
    gap: "1rem",
    fontSize: "0.7rem",
    color: "var(--muted)",
    flexWrap: "wrap" as const,
    justifyContent: "center",
  },
};
