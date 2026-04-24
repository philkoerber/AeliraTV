export function normalizeSeed(seed: string | number | undefined): number {
  if (seed === undefined) return 1337;
  if (typeof seed === "number" && Number.isFinite(seed)) return seed | 0;
  return hashStringToInt32(String(seed));
}

/** Server-owned canonical seed string for a Colyseus room (not trusting client join options). */
export function canonicalWorldSeedFromRoomId(roomId: string): string {
  return `w:${roomId}`;
}

function hashStringToInt32(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

