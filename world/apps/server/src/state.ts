import { MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
}

export class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

export type PlayerInput = {
  forward: number; // -1..1
  right: number; // -1..1
  yaw: number; // absolute yaw, radians
};

