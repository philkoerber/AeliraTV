import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useState } from "react";
export function DevScreenshotPanel() {
    const [posX, setPosX] = useState("12");
    const [posZ, setPosZ] = useState("12");
    const [lookX, setLookX] = useState("0");
    const [lookZ, setLookZ] = useState("0");
    const [fov, setFov] = useState("55");
    const [msg, setMsg] = useState(null);
    const capture = useCallback(() => {
        const api = window.__AELIRA_DEV__;
        if (!api) {
            setMsg("Canvas API not ready yet — wait a second after load.");
            return;
        }
        try {
            const dataUrl = api.captureScreenshot({
                position: { x: Number(posX), z: Number(posZ) },
                lookAt: { x: Number(lookX), z: Number(lookZ) },
                fov: Number(fov) || 60
            });
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `aelira-world-${Date.now()}.png`;
            a.click();
            setMsg(null);
        }
        catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        }
    }, [posX, posZ, lookX, lookZ, fov]);
    return (_jsxs("div", { style: {
            position: "fixed",
            right: 12,
            top: 56,
            zIndex: 50,
            width: 248,
            padding: 10,
            borderRadius: 10,
            background: "rgba(10,12,18,0.82)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12,
            lineHeight: 1.35,
            boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
            pointerEvents: "auto"
        }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: "Developer: world screenshot" }), _jsx("div", { style: { opacity: 0.78, marginBottom: 8 }, children: "Camera at world (x, z); Y follows terrain + eye height. Looks at (x, z) on terrain + offset." }), _jsxs("label", { style: { display: "grid", gap: 4, marginBottom: 8 }, children: [_jsx("span", { style: { opacity: 0.75 }, children: "Camera X / Z" }), _jsxs("span", { style: { display: "flex", gap: 6 }, children: [_jsx("input", { value: posX, onChange: (e) => setPosX(e.target.value), style: inputStyle }), _jsx("input", { value: posZ, onChange: (e) => setPosZ(e.target.value), style: inputStyle })] })] }), _jsxs("label", { style: { display: "grid", gap: 4, marginBottom: 8 }, children: [_jsx("span", { style: { opacity: 0.75 }, children: "Look-at X / Z" }), _jsxs("span", { style: { display: "flex", gap: 6 }, children: [_jsx("input", { value: lookX, onChange: (e) => setLookX(e.target.value), style: inputStyle }), _jsx("input", { value: lookZ, onChange: (e) => setLookZ(e.target.value), style: inputStyle })] })] }), _jsxs("label", { style: { display: "grid", gap: 4, marginBottom: 10 }, children: [_jsx("span", { style: { opacity: 0.75 }, children: "FOV (deg)" }), _jsx("input", { value: fov, onChange: (e) => setFov(e.target.value), style: { ...inputStyle, width: "100%" } })] }), _jsx("button", { type: "button", onClick: capture, style: btnStyle, children: "Download PNG" }), msg ? _jsx("div", { style: { marginTop: 8, color: "#ffb4b4" }, children: msg }) : null, _jsxs("div", { style: { marginTop: 10, opacity: 0.65, fontSize: 11 }, children: ["Or in the console:", " ", _jsx("code", { style: { wordBreak: "break-all" }, children: `__AELIRA_DEV__.captureScreenshot({ position: { x: 12, z: 12 }, lookAt: { x: 0, z: 0 } })` })] })] }));
}
const inputStyle = {
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit"
};
const btnStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(120,160,255,0.22)",
    color: "inherit",
    cursor: "pointer",
    fontWeight: 600
};
