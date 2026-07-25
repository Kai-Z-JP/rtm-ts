import { Entity } from "net.minecraft.entity";

export declare class RTMApiCompat {
  static targetName(): string;
  static debug(message: string): void;
  static getRider(entity: Entity): Entity | null;
  static getRidingEntity(entity: Entity): Entity | null;
  static dismount(entity: Entity): void;
  static getEntityId(entity: Entity): number;
}
