import { Client, Room } from "colyseus.js";

export type NetPlayer = {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
};

export type WorldRoomState = {
  players: Map<string, NetPlayer>;
};

export async function joinWorld(endpoint: string, name: string): Promise<Room> {
  const client = new Client(endpoint);
  const room = await client.joinOrCreate("world", { name });
  return room;
}

