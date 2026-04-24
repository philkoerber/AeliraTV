/** HUD on in dev, or when `?perf=1` or `localStorage.worldPerfHud === "1"`. */
export function isWorldPerfHudEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") return true;
    if (window.localStorage.getItem("worldPerfHud") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}
