/** Short neutral tokens; combined with a hyphen and 3-char base36 suffix (e.g. `Fox-7K2`). */
const WORDS = [
  "Ash",
  "Bay",
  "Brook",
  "Cliff",
  "Cove",
  "Delta",
  "Echo",
  "Elm",
  "Fern",
  "Flint",
  "Fox",
  "Glen",
  "Grove",
  "Hawk",
  "Heath",
  "Iris",
  "Jade",
  "Kelp",
  "Knot",
  "Lake",
  "Loam",
  "Marsh",
  "Moss",
  "Oak",
  "Pine",
  "Quartz",
  "Reed",
  "Slate",
  "Tide",
  "Vale",
  "Wren",
  "Yew"
] as const;

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Linear congruential uint32 step (deterministic). */
function nextU32(state: number): [number, number] {
  const s = (Math.imul(state | 0, 1664525) + 1013904223) >>> 0;
  return [s, s];
}

/**
 * Display name from a uint32 seed. Same seed always yields the same string on all platforms.
 * Output length is at most 9 characters (5 + 1 + 3), under the server's 24-char cap.
 */
export function neutralShortNameFromSeed(seed: number): string {
  let s = seed >>> 0;
  let t: number;
  [s, t] = nextU32(s);
  const word = WORDS[t % WORDS.length]!;
  [s, t] = nextU32(s);
  let n = t % (36 * 36 * 36);
  let suffix = "";
  for (let i = 0; i < 3; i++) {
    suffix = BASE36[n % 36]! + suffix;
    n = Math.floor(n / 36);
  }
  return `${word}-${suffix}`;
}
