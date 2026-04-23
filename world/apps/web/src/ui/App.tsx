import React, { useMemo, useState } from "react";
import { Game } from "../world/Game";

export function App() {
  const [name, setName] = useState("");
  const [joinedName, setJoinedName] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    return (
      import.meta.env.VITE_COLYSEUS_ENDPOINT?.trim() || "http://localhost:2567"
    );
  }, []);

  if (joinedName) {
    return (
      <div className="gameRoot">
        <div className="overlayTopLeft">
          <div>
            <strong>{joinedName}</strong>
          </div>
          <div>WASD to move. Click to lock mouse. Esc to unlock.</div>
        </div>
        <Game name={joinedName} endpoint={endpoint} />
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="card">
        <div className="row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={24}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = name.trim();
                if (n) setJoinedName(n);
              }
            }}
          />
          <button
            onClick={() => {
              const n = name.trim();
              if (n) setJoinedName(n);
            }}
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
