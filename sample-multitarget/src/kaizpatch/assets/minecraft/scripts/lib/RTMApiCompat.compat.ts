import { NGTLog } from "jp.ngt.ngtlib.io";

export class RTMApiCompat {
  static targetName(): string {
    return "kaizpatch";
  }

  static debug(message: string): void {
    NGTLog.debug("[rtmx multi-target:kaizpatch] " + message);
  }
}
