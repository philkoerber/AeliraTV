import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Game } from "../world/Game.js";
export function App() {
    const [name, setName] = useState("");
    const [joinedName, setJoinedName] = useState(null);
    const endpoint = useMemo(() => {
        return import.meta.env.VITE_COLYSEUS_ENDPOINT?.trim() || "http://localhost:2567";
    }, []);
    if (joinedName) {
        return (_jsxs("div", { className: "gameRoot", children: [_jsxs("div", { className: "overlayTopLeft", children: [_jsx("div", { children: _jsx("strong", { children: joinedName }) }), _jsx("div", { children: "WASD to move. Click to lock mouse. Esc to unlock." })] }), _jsx(Game, { name: joinedName, endpoint: endpoint })] }));
    }
    return (_jsx("div", { className: "shell", children: _jsxs("div", { className: "card", children: [_jsx("h2", { style: { margin: "0 0 12px 0" }, children: "World" }), _jsxs("div", { className: "row", children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "Your name", maxLength: 24, autoFocus: true, onKeyDown: (e) => {
                                if (e.key === "Enter") {
                                    const n = name.trim();
                                    if (n)
                                        setJoinedName(n);
                                }
                            } }), _jsx("button", { onClick: () => {
                                const n = name.trim();
                                if (n)
                                    setJoinedName(n);
                            }, children: "Enter" })] }), _jsx("div", { className: "hint", children: "This is the minimal MVP: spawn at (0,0), walk around, and see other players." })] }) }));
}
