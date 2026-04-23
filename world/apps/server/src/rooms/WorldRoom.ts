import { Room, type Client } from "@colyseus/core";
import { PlayerState, type PlayerInput, WorldState } from "../state.js";

type JoinOptions = { name?: string };

export class WorldRoom extends Room<WorldState> {
  private lastInputBySessionId = new Map<string, PlayerInput>();
  private lastLoggedAtBySessionId = new Map<string, number>();

  override onCreate() {
    // eslint-disable-next-line no-console
    console.log("[WorldRoom] onCreate", this.roomId);
    this.setState(new WorldState());

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
    const name = (options?.name ?? "").trim().slice(0, 24) || "Player";

    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = name;
    p.x = 0;
    p.z = 0;
    p.yaw = 0;
    this.state.players.set(client.sessionId, p);

    this.lastInputBySessionId.set(client.sessionId, { forward: 0, right: 0, yaw: 0 });
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.lastInputBySessionId.delete(client.sessionId);
    this.lastLoggedAtBySessionId.delete(client.sessionId);
  }

  private update(deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    const speed = 6; // units/s

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

      p.x += dx;
      p.z += dz;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

