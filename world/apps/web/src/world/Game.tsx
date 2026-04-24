import type { Room } from "colyseus.js";
import React, { useEffect, useRef, useState } from "react";
import { useColyseusNetProbe } from "./perf/colyseusNetProbe.js";
import { PerfHud } from "./perf/PerfHud.js";
import { isWorldPerfHudEnabled } from "./perf/perfHudGate.js";
import { joinWorld } from "./net.js";
import { WorldCanvas } from "./scene/WorldCanvas";

type Props = {
  name: string;
  endpoint: string;
  onExit: () => void;
};

export function Game({ name, endpoint, onExit }: Props) {
  const joinGenerationRef = useRef(0);
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  useColyseusNetProbe(room);
  const showPerfHud = isWorldPerfHudEnabled();

  useEffect(() => {
    let disposed = false;
    const effectId = ++joinGenerationRef.current;
    setError(null);

    (async () => {
      try {
        const joinedRoom = await joinWorld(endpoint, name);
        if (disposed || joinGenerationRef.current !== effectId) {
          try {
            joinedRoom?.leave?.();
          } catch {
            // ignore
          }
          return;
        }
        setRoom(joinedRoom);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      setRoom((r) => {
        try {
          r?.leave?.();
        } catch {
          // ignore
        }
        return null;
      });
    };
  }, [endpoint, name]);

  if (error) {
    return (
      <div className="mvpCenter mvpError">
        <p>Failed to connect: {error}</p>
        <button type="button" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="mvpCenter mvpMuted">
        <p>Connecting…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: "100dvh", position: "relative", width: "100%" }}>
      <div className="overlayTopLeft">
        <div>
          <strong>{name}</strong>
          <span className="mvpSep">·</span>
          <span className="mvpMuted">room {room.roomId}</span>
        </div>
        <div className="mvpHint" style={{ marginTop: 6 }}>
          WASD to move. Click canvas to lock the mouse — drag to turn the camera (WoW-style). Esc unlocks.
        </div>
        <button type="button" className="mvpLeave" style={{ marginTop: 8 }} onClick={onExit}>
          Leave
        </button>
      </div>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <WorldCanvas room={room} />
      </div>
      {showPerfHud ? <PerfHud /> : null}
    </div>
  );
}
