import { Client, Room } from "colyseus.js";

export type NetPlayer = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
};

/** Mirrors authoritative `WorldState` contract fields (server-owned). */
export type WorldContractNet = {
  worldSeed: string;
  rulesetVersion: number;
  generatorBuild: number;
  chunkSize: number;
  persistentDeltaVersion: number;
  lodProfileId: number;
};

export type WorldRoomState = WorldContractNet & {
  players: Map<string, NetPlayer>;
};

/** Ephemeral: client requests view radius; server derives chunk center from authoritative position. */
export type ChunkInterestPayload = {
  radius: number;
};

export async function joinWorld(endpoint: string, name: string): Promise<Room> {
  const client = new Client(endpoint);
  const room = await client.joinOrCreate("world", { name });
  return room;
}

