import { NGTLog } from "jp.ngt.ngtlib.io";
import { Entity } from "net.minecraft.entity";
import { BlockPos } from "net.minecraft.util.math";

export class RTMApiCompat {
  static targetName(): string {
    return "mc1122";
  }

  static debug(message: string): void {
    NGTLog.debug("[rtmx multi-target:mc1122] " + message);
  }

  static getRider(entity: Entity): Entity | null {
    return entity.getControllingPassenger() ?? null;
  }

  static getRidingEntity(entity: Entity): Entity | null {
    return entity.getRidingEntity() ?? null;
  }

  static dismount(entity: Entity): void {
    const rider = RTMApiCompat.getRider(entity);
    if (rider) rider.dismountRidingEntity();
  }

  static getEntityId(entity: Entity): number {
    return entity.getEntityId() ?? 0;
  }

  static blockPos(x: number, y: number, z: number): unknown {
    return new BlockPos(Math.floor(x), Math.floor(y), Math.floor(z));
  }
}
