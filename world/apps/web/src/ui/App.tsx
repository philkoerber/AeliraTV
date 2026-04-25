import { neutralShortNameFromSeed } from "@aeliratv/shared-world";
import React, { useMemo, useState } from "react";
import { Game } from "../world/Game";

function randomUint32(): number {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0] ?? 0;
}

export function App() {
  const [nameSeed, setNameSeed] = useState(() => randomUint32());
  const [joinedSeed, setJoinedSeed] = useState<number | null>(null);

  const endpoint = useMemo(() => {
    return (
      import.meta.env.VITE_COLYSEUS_ENDPOINT?.trim() || "http://localhost:2567"
    );
  }, []);

  if (joinedSeed !== null) {
    return (
      <div className="gameRoot">
        <Game
          nameSeed={joinedSeed}
          endpoint={endpoint}
          onExit={() => setJoinedSeed(null)}
        />
      </div>
    );
  }

  const preview = neutralShortNameFromSeed(nameSeed);

  return (
    <div className="shell">
      <div className="card">
        <div className="row">
          <span className="namePreview" title="Generated name">
            {preview}
          </span>
          <button type="button" onClick={() => setNameSeed(randomUint32())}>
            Reroll
          </button>
          <button type="button" onClick={() => setJoinedSeed(nameSeed)}>
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
