import { Client } from "colyseus.js";
export async function joinWorld(endpoint, name) {
    const client = new Client(endpoint);
    const room = await client.joinOrCreate("world", { name });
    return room;
}
