import type { Room } from "colyseus.js";
import { useEffect } from "react";
import { perfSnapshot } from "./perfStore.js";

type RoomWithConnection = Room & {
  connection?: {
    send: (data: ArrayBuffer | number[]) => void;
    events: { onmessage?: (event: MessageEvent) => void };
  };
};

function byteLengthIncoming(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return 0;
  if (typeof data === "string") return new TextEncoder().encode(data).length;
  return 0;
}

/**
 * Tracks Colyseus traffic into `perfSnapshot`.
 * - `onStateChange`: counts applied state patches (proxy for patch activity).
 * - `connection.send`: exact outgoing byte length (all protocol frames).
 * - `connection.events.onmessage`: incoming WebSocket binary length when hook succeeds.
 * Deep byte-level inspection of schema patches: use browser DevTools → Network → WS frames.
 */
export function useColyseusNetProbe(room: Room | null): void {
  useEffect(() => {
    if (!room) return;

    let patchesThisSec = 0;
    let inBytesThisSec = 0;
    let prevOutgoingBytes = perfSnapshot.outgoingBytesTotal;
    let prevOutgoingSends = perfSnapshot.outgoingSendsTotal;

    const onState = (): void => {
      patchesThisSec += 1;
      perfSnapshot.statePatchesTotal += 1;
    };
    room.onStateChange(onState);

    const r = room as RoomWithConnection;
    const conn = r.connection;
    let restoreSend: (() => void) | undefined;
    let restoreOnMessage: (() => void) | undefined;

    if (conn?.send) {
      const origSend = conn.send.bind(conn);
      conn.send = (data: ArrayBuffer | number[]) => {
        let len = 0;
        if (data instanceof ArrayBuffer) len = data.byteLength;
        else len = new Uint8Array(data).byteLength;
        perfSnapshot.outgoingSendsTotal += 1;
        perfSnapshot.outgoingBytesTotal += len;
        origSend(data);
      };
      restoreSend = () => {
        conn.send = origSend;
      };
    }

    const prevOnMessage = conn?.events?.onmessage;
    if (conn?.events && prevOnMessage) {
      conn.events.onmessage = (event: MessageEvent) => {
        const len = byteLengthIncoming(event.data);
        inBytesThisSec += len;
        perfSnapshot.incomingWsBytesTotal += len;
        prevOnMessage(event);
      };
      perfSnapshot.incomingWsHooked = true;
      restoreOnMessage = () => {
        conn.events.onmessage = prevOnMessage;
      };
    } else {
      perfSnapshot.incomingWsHooked = false;
    }

    const id = window.setInterval(() => {
      perfSnapshot.statePatchesPerSec = patchesThisSec;
      patchesThisSec = 0;
      perfSnapshot.incomingWsBytesPerSec = inBytesThisSec;
      inBytesThisSec = 0;

      const ob = perfSnapshot.outgoingBytesTotal;
      const os = perfSnapshot.outgoingSendsTotal;
      perfSnapshot.outgoingBytesPerSec = ob - prevOutgoingBytes;
      perfSnapshot.outgoingSendsPerSec = os - prevOutgoingSends;
      prevOutgoingBytes = ob;
      prevOutgoingSends = os;
    }, 1000);

    return () => {
      window.clearInterval(id);
      room.onStateChange.remove(onState);
      restoreSend?.();
      restoreOnMessage?.();
      perfSnapshot.incomingWsHooked = false;
    };
  }, [room]);
}
