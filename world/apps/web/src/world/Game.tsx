import React, { useEffect, useRef, useState } from "react";
import { joinWorld } from "./net.js";
import { WorldCanvas } from "./scene/WorldScene.js";

type Props = {
  name: string;
  endpoint: string;
};

export function Game({ name, endpoint }: Props) {
  const joinGenerationRef = useRef(0);
  const [room, setRoom] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setRoom((r: any) => {
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
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 16, color: "#ffb4b4" }}>
        Failed to connect: {error}
      </div>
    );
  }

  if (!room) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 16, color: "rgba(255,255,255,0.75)" }}>
        Connecting…
      </div>
    );
  }

  return (
    <div style={{ height: "100%" }}>
      <WorldCanvas room={room} displayName={name} />
    </div>
  );
}
