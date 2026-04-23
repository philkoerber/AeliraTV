import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { DevScreenshotPanel } from "../ui/DevScreenshotPanel.js";
import { isDevAccessEnabled } from "./dev/worldDevAccess.js";
import { joinWorld } from "./net.js";
import { WorldCanvas } from "./scene/WorldScene.js";
export function Game({ name, endpoint }) {
    const joinGenerationRef = useRef(0);
    const [room, setRoom] = useState(null);
    const [error, setError] = useState(null);
    const devAccess = useMemo(() => isDevAccessEnabled(), []);
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
                    }
                    catch {
                        // ignore
                    }
                    return;
                }
                setRoom(joinedRoom);
            }
            catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => {
            disposed = true;
            setRoom((r) => {
                try {
                    r?.leave?.();
                }
                catch {
                    // ignore
                }
                return null;
            });
        };
    }, [endpoint, name]);
    if (error) {
        return (_jsxs("div", { style: { height: "100%", display: "grid", placeItems: "center", padding: 16, color: "#ffb4b4" }, children: ["Failed to connect: ", error] }));
    }
    if (!room) {
        return (_jsx("div", { style: { height: "100%", display: "grid", placeItems: "center", padding: 16, color: "rgba(255,255,255,0.75)" }, children: "Connecting\u2026" }));
    }
    return (_jsxs("div", { style: { height: "100%", position: "relative" }, children: [_jsx(WorldCanvas, { room: room, displayName: name, devAccessEnabled: devAccess }), devAccess ? _jsx(DevScreenshotPanel, {}) : null] }));
}
