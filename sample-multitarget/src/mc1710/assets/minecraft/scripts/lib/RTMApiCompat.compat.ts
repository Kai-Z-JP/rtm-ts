import { NGTLog } from "jp.ngt.ngtlib.io";
import { Entity } from "net.minecraft.entity";

export class RTMApiCompat {
  static targetName(): string {
    return "mc1710";
  }

  static debug(message: string): void {
    NGTLog.debug("[rtmx multi-target:mc1710] " + message);
  }

  static getRider(entity: Entity): Entity | null {
    return entity.riddenByEntity ?? null;
  }

  static getRidingEntity(entity: Entity): Entity | null {
    return entity.ridingEntity ?? null;
  }

  static dismount(entity: Entity): void {
    const rider = RTMApiCompat.getRider(entity);
    if (rider) rider.mountEntity(null!);
  }

  static getEntityId(entity: Entity): number {
    return entity.getEntityId() ?? 0;
  }
}
