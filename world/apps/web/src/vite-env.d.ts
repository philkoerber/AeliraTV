/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COLYSEUS_ENDPOINT?: string;
  /** Set to `1` to allow dev tools in non-dev builds (still requires `?dev=1`). */
  readonly VITE_DEV_ACCESS?: string;
  /** If set, `?dev=1` alone is not enough; URL must include `&secret=<value>`. */
  readonly VITE_DEV_ACCESS_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
