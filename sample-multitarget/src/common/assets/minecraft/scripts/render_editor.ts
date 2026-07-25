import { RTMApiCompat } from "@target/assets/minecraft/scripts/lib/RTMApiCompat";
import { EntityVehicle } from "jp.ngt.rtm.entity.vehicle";

declare global {
  var RTMX_SAMPLE_RENDER_COUNT: number;
}

function init(): void {
  RTMX_SAMPLE_RENDER_COUNT = 0;
  RTMApiCompat.debug("render init: " + RTMApiCompat.targetName());
}

function render(entity: EntityVehicle, pass: number, par3: number): void {
  void par3;
  if (pass !== 0) return;
  RTMX_SAMPLE_RENDER_COUNT++;

  if (RTMX_SAMPLE_RENDER_COUNT === 1) {
    RTMApiCompat.debug("first render on " + RTMApiCompat.targetName());
  }

  const rider = RTMApiCompat.getRider(entity);
  if (rider) {
    RTMApiCompat.debug("render rider id=" + RTMApiCompat.getEntityId(rider));
  }
}
