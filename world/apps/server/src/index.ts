import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./rooms/WorldRoom.js";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport()
});

gameServer.define("world", WorldRoom);

await gameServer.listen(port, "0.0.0.0");
// eslint-disable-next-line no-console
console.log(`[world-server] listening on :${port}`);

