function truthyEnv(v) {
    const t = v?.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes";
}
/**
 * Dev tools are only available when builds allow it and the URL opts in (`?dev=1`).
 * In Vite dev, you may also enable via `localStorage.setItem("aeliraDevAccess","1")` then reload.
 */
export function isDevAccessEnabled() {
    if (typeof window === "undefined")
        return false;
    const allowBuild = Boolean(import.meta.env.DEV) || truthyEnv(import.meta.env.VITE_DEV_ACCESS);
    if (!allowBuild)
        return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") !== "1") {
        if (import.meta.env.DEV && window.localStorage.getItem("aeliraDevAccess") === "1")
            return true;
        return false;
    }
    const secret = import.meta.env.VITE_DEV_ACCESS_SECRET?.trim();
    if (secret && params.get("secret") !== secret)
        return false;
    return true;
}
export function registerAeliraDevApi(api) {
    window.__AELIRA_DEV__ = api;
    return () => {
        if (window.__AELIRA_DEV__ === api)
            delete window.__AELIRA_DEV__;
    };
}
