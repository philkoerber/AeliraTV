export type DevScreenshotPosition = {
  x: number;
  /** If omitted, uses terrain height at (x,z) plus `eyeOffset`. */
  y?: number;
  z: number;
};

export type DevScreenshotLookAt = {
  x: number;
  /** If omitted, uses terrain height at (x,z) plus `lookOffset`. */
  y?: number;
  z: number;
};

export type DevScreenshotOpts = {
  position: DevScreenshotPosition;
  /** Defaults to near world origin on the terrain. */
  lookAt?: DevScreenshotLookAt;
  /** Field of view in degrees. */
  fov?: number;
  /** Meters above terrain when `position.y` is omitted. */
  eyeOffset?: number;
  /** Meters above terrain when `lookAt.y` is omitted. */
  lookOffset?: number;
  /** Camera near/far; defaults match the main world camera. */
  near?: number;
  far?: number;
};

export type AeliraWorldDevApi = {
  version: 1;
  /** Renders one frame from `opts.position` toward `opts.lookAt` and returns a PNG data URL. */
  captureScreenshot: (opts: DevScreenshotOpts) => string;
};

declare global {
  interface Window {
    __AELIRA_DEV__?: AeliraWorldDevApi;
  }
}

function truthyEnv(v: string | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

/**
 * Dev tools are only available when builds allow it and the URL opts in (`?dev=1`).
 * In Vite dev, you may also enable via `localStorage.setItem("aeliraDevAccess","1")` then reload.
 */
export function isDevAccessEnabled(): boolean {
  if (typeof window === "undefined") return false;

  const allowBuild = Boolean(import.meta.env.DEV) || truthyEnv(import.meta.env.VITE_DEV_ACCESS);
  if (!allowBuild) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get("dev") !== "1") {
    if (import.meta.env.DEV && window.localStorage.getItem("aeliraDevAccess") === "1") return true;
    return false;
  }

  const secret = import.meta.env.VITE_DEV_ACCESS_SECRET?.trim();
  if (secret && params.get("secret") !== secret) return false;

  return true;
}

export function registerAeliraDevApi(api: AeliraWorldDevApi): () => void {
  window.__AELIRA_DEV__ = api;
  return () => {
    if (window.__AELIRA_DEV__ === api) delete window.__AELIRA_DEV__;
  };
}
