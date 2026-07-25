import { RTMApiCompat } from "@target/assets/minecraft/scripts/lib/RTMApiCompat";
import { Entity } from "net.minecraft.entity";
import { ScriptExecuter } from "jp.ngt.rtm.modelpack";

declare global {
  var RTMX_SAMPLE_UPDATE_COUNT: number;
}

function init(entity: Entity, scriptExecuter: ScriptExecuter): void {
  void entity;
  void scriptExecuter;
  RTMX_SAMPLE_UPDATE_COUNT = 0;
  RTMApiCompat.debug("server init: " + RTMApiCompat.targetName());
}

function onUpdate(entity: Entity, scriptExecuter: ScriptExecuter): void {
  void scriptExecuter;
  RTMX_SAMPLE_UPDATE_COUNT++;

  const rider = RTMApiCompat.getRider(entity);
  if (rider && RTMX_SAMPLE_UPDATE_COUNT % 100 === 0) {
    RTMApiCompat.debug("server rider id=" + RTMApiCompat.getEntityId(rider));
  }
}
