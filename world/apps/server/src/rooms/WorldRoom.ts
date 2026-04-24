import {
  canonicalWorldSeedFromRoomId,
  DEFAULT_CHUNK_SIZE,
  GENERATOR_BUILD,
  RULESET_VERSION,
  surfaceHeightAt,
  terrainConfigFromContract,
  walkClassAt,
  WalkClass,
  worldXZToChunk
} from "@aeliratv/shared-world";
import { Room, type Client } from "@colyseus/core";
import { PlayerState, type PlayerInput, WorldState } from "../state.js";

const PLAYER_HALF_HEIGHT = 0.55;

type JoinOptions = { name?: string; requestedShard?: string };

type ChunkInterestMsg = { radius?: number };

type ChunkInterestRecord = { cx: number; cz: number; radius: number; atMs: number };

export class WorldRoom extends Room<WorldState> {
  private lastInputBySessionId = new Map<string, PlayerInput>();
  private lastLoggedAtBySessionId = new Map<string, number>();
  /** Ephemeral client interest; center is always derived from authoritative player XZ. */
  private chunkInterestBySessionId = new Map<string, ChunkInterestRecord>();
  private lastLoggedChunkWindowBySessionId = new Map<string, string>();

  override onCreate() {
    // eslint-disable-next-line no-console
    console.log("[WorldRoom] onCreate", this.roomId);
    this.setState(new WorldState());

    const worldSeed = canonicalWorldSeedFromRoomId(this.roomId);
    this.state.worldSeed = worldSeed;
    this.state.rulesetVersion = RULESET_VERSION;
    this.state.generatorBuild = GENERATOR_BUILD;
    this.state.chunkSize = DEFAULT_CHUNK_SIZE;
    this.state.persistentDeltaVersion = 0;
    this.state.lodProfileId = 0;

    this.onMessage("chunkInterest", (client, msg: ChunkInterestMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const S = this.state.chunkSize;
      if (!Number.isFinite(S) || S <= 0) return;
      const { cx, cz } = worldXZToChunk(p.x, p.z, S);
      const r = clampInt(Math.floor(Number(msg?.radius)), 0, 2, 1);
      const atMs = Date.now();
      this.chunkInterestBySessionId.set(client.sessionId, { cx, cz, radius: r, atMs });
      const sig = `${cx},${cz},${r}`;
      if (this.lastLoggedChunkWindowBySessionId.get(client.sessionId) !== sig) {
        this.lastLoggedChunkWindowBySessionId.set(client.sessionId, sig);
        // eslint-disable-next-line no-console
        console.log("[WorldRoom] chunkInterest", client.sessionId, { cx, cz, radius: r });
      }
    });

    this.onMessage("input", (client, msg: PlayerInput) => {
      if (!msg) return;
      const forward = clamp(msg.forward, -1, 1);
      const right = clamp(msg.right, -1, 1);
      const yaw = Number.isFinite(msg.yaw) ? msg.yaw : 0;
      this.lastInputBySessionId.set(client.sessionId, { forward, right, yaw });

      // Debug: log non-zero input at most 2x/sec per client.
      if (forward !== 0 || right !== 0) {
        const now = Date.now();
        const last = this.lastLoggedAtBySessionId.get(client.sessionId) ?? 0;
        if (now - last > 500) {
          this.lastLoggedAtBySessionId.set(client.sessionId, now);
          // eslint-disable-next-line no-console
          console.log("[WorldRoom] input", client.sessionId, { forward, right });
        }
      }
    });

    // ~60Hz authoritative tick (smoother movement for an MVP LAN setup).
    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 16);
  }

  override onJoin(client: Client, options: JoinOptions) {
    // eslint-disable-next-line no-console
    console.log("[WorldRoom] onJoin", client.sessionId, options);
    if (options?.requestedShard) {
      // eslint-disable-next-line no-console
      console.log("[WorldRoom] requestedShard (ignored for MVP)", options.requestedShard);
    }
    const name = (options?.name ?? "").trim().slice(0, 24) || "Player";

    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = name;
    p.x = 0;
    p.z = 0;
    p.yaw = 0;
    const cfg = terrainConfigFromContract({ worldSeed: this.state.worldSeed });
    p.y = surfaceHeightAt(0, 0, cfg) + PLAYER_HALF_HEIGHT;
    this.state.players.set(client.sessionId, p);

    this.lastInputBySessionId.set(client.sessionId, { forward: 0, right: 0, yaw: 0 });
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.lastInputBySessionId.delete(client.sessionId);
    this.lastLoggedAtBySessionId.delete(client.sessionId);
    this.chunkInterestBySessionId.delete(client.sessionId);
    this.lastLoggedChunkWindowBySessionId.delete(client.sessionId);
  }

  private update(deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    const speed = 6; // units/s
    const cfg = terrainConfigFromContract({ worldSeed: this.state.worldSeed });

    for (const [id, p] of this.state.players.entries()) {
      const input = this.lastInputBySessionId.get(id);
      if (!input) continue;

      p.yaw = input.yaw;

      // Movement in XZ relative to yaw.
      const sin = Math.sin(p.yaw);
      const cos = Math.cos(p.yaw);
      const f = input.forward;
      const r = input.right;

      // forward (0,1) rotated by yaw; right (1,0) rotated by yaw
      // Camera yaw increases CCW when mouse moves left; match strafe direction to that convention.
      const dx = (sin * f - cos * r) * speed * dt;
      const dz = (cos * f + sin * r) * speed * dt;

      const nx = p.x + dx;
      const nz = p.z + dz;
      if (walkClassAt(nx, nz, cfg) !== WalkClass.Blocked) {
        p.x = nx;
        p.z = nz;
      }
      p.y = surfaceHeightAt(p.x, p.z, cfg) + PLAYER_HALF_HEIGHT;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

