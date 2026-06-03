import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyBuildAssets, copyMultiTargetBuildAssets } from "../assets.js";

describe("assets", () => {
  it("single-target build assets are copied to outDir and TypeScript files are skipped", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-assets-single-"));
    try {
      const srcDir = path.join(root, "src");
      const outDir = path.join(root, "dist");
      mkdirSync(path.join(srcDir, "assets/minecraft/models/json"), { recursive: true });
      mkdirSync(path.join(srcDir, "assets/minecraft/scripts"), { recursive: true });
      writeFileSync(
        path.join(srcDir, "assets/minecraft/models/json/Model.json"),
        '{"name":"model"}\n',
        "utf-8"
      );
      writeFileSync(
        path.join(srcDir, "assets/minecraft/scripts/legacy.js"),
        "function legacy() {}\n",
        "utf-8"
      );
      writeFileSync(
        path.join(srcDir, "assets/minecraft/scripts/render.ts"),
        "function render() {}\n",
        "utf-8"
      );

      const result = copyBuildAssets({
        name: "test",
        srcDir,
        outDir,
        typings: [],
        mapping: "",
      });

      expect(result.copied).toBe(2);
      expect(
        readFileSync(path.join(outDir, "assets/minecraft/models/json/Model.json"), "utf-8")
      ).toBe('{"name":"model"}\n');
      expect(existsSync(path.join(outDir, "assets/minecraft/scripts/legacy.js"))).toBe(true);
      expect(existsSync(path.join(outDir, "assets/minecraft/scripts/render.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("multi-target build assets keep common paths and strip assets/minecraft for targets", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-assets-multi-"));
    try {
      const commonDir = path.join(root, "src/common");
      const targetDir = path.join(root, "src/mc1122");
      const outDir = path.join(root, "dist");
      const targetOutDir = path.join(outDir, "assets/minecraft/__targets__/mc1122");
      mkdirSync(path.join(commonDir, "assets/minecraft/textures/common"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/textures/target"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/scripts/lib"), { recursive: true });
      writeFileSync(
        path.join(commonDir, "assets/minecraft/textures/common/common.png"),
        "common",
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/textures/target/target.png"),
        "target",
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Compat.compat.ts"),
        "export function helper() {}\n",
        "utf-8"
      );

      const result = copyMultiTargetBuildAssets({
        name: "test",
        entries: [],
        runtimeDispatch: [],
        outDir,
        commonSrcDir: commonDir,
        commonApiManifest: path.join(root, "generated/common-api.json"),
        commonApiTypingsDir: path.join(root, "generated/common/typings"),
        commonApiPolicy: "allow",
        targets: {
          mc1122: {
            name: "test",
            srcDir: commonDir,
            srcDirs: [commonDir, targetDir],
            outDir: targetOutDir,
            typings: [],
            mapping: "",
            targetName: "mc1122",
          },
        },
      });

      expect(result.copied).toBe(2);
      expect(
        readFileSync(
          path.join(outDir, "assets/minecraft/textures/common/common.png"),
          "utf-8"
        )
      ).toBe("common");
      expect(
        readFileSync(path.join(targetOutDir, "textures/target/target.png"), "utf-8")
      ).toBe("target");
      expect(
        existsSync(path.join(targetOutDir, "assets/minecraft/textures/target/target.png"))
      ).toBe(false);
      expect(existsSync(path.join(targetOutDir, "scripts/lib/Compat.compat.ts"))).toBe(false);
      expect(
        existsSync(path.join(targetOutDir, "textures/common/common.png"))
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
