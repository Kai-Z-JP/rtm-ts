import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { isMultiTargetConfig, loadConfig } from "../config.js";

describe("config", () => {
  it("multi-target scan defaults are resolved per target", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-config-"));
    try {
      const configPath = path.join(root, "rtmx.json");
      mkdirSync(path.join(root, "src/common/assets/minecraft/scripts"), { recursive: true });
      writeFileSync(
        path.join(root, "src/common/assets/minecraft/scripts/render_editor.ts"),
        "function render() {}\n",
        "utf-8"
      );
      writeFileSync(
        path.join(root, "src/common/assets/minecraft/scripts/not_entry.compat.ts"),
        "export const value = 1;\n",
        "utf-8"
      );
      writeFileSync(
        configPath,
        JSON.stringify({
          name: "sample",
          targets: {
            kaizpatch: {
              compatFallbackTarget: "mc1710",
              runtimeDispatch: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('KaizPatch') !== -1",
              srcDirs: ["src/common", "src/kaizpatch"],
              outDir: "dist/assets/minecraft/__targets__/kaizpatch",
              scan: {
                minecraftVersion: "1.7.10",
                forgeVersion: "10.13.4.1614",
                mappingsVersion: "12",
                mods: ["com.github.Kai-Z-JP:KaizPatchX:v1.9.5"],
                packages: ["net.minecraft", "net.minecraftforge", "cpw.mods", "jp.ngt"],
              },
            },
            mc1710: {
              runtimeDispatch: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0",
              srcDirs: ["src/common", "src/mc1710"],
              outDir: "dist/assets/minecraft/__targets__/mc1710",
              scan: {
                minecraftVersion: "1.7.10",
                forgeVersion: "10.13.4.1614",
                mappingsVersion: "12",
                mods: [
                  "curse.maven:ngtlib-288989:6505474",
                  "curse.maven:realtrainmod-288988:6505479",
                ],
                packages: ["net.minecraft", "net.minecraftforge", "cpw.mods", "jp.ngt"],
              },
            },
            mc1122: {
              runtimeDispatch: "true",
              srcDirs: ["src/common", "src/mc1122"],
              outDir: "dist/assets/minecraft/__targets__/mc1122",
              scan: {
                minecraftVersion: "1.12.2",
                forgeVersion: "14.23.5.2860",
                mappingsVersion: "39",
                mods: [
                  "curse.maven:ngtlib-288989:4641592",
                  "curse.maven:realtrainmod-288988:4641603",
                ],
                packages: [
                  "net.minecraft",
                  "net.minecraftforge",
                  "net.minecraftforge.fml",
                  "jp.ngt",
                ],
              },
            },
          },
        }),
        "utf-8"
      );

      const config = loadConfig(configPath);
      expect(isMultiTargetConfig(config)).toBe(true);
      if (!isMultiTargetConfig(config)) return;

      expect(config.targets.kaizpatch.scan?.outputDir).toBe(path.join(root, "generated/kaizpatch"));
      expect(config.targets.kaizpatch.compatFallbackTarget).toBe("mc1710");
      expect(config.targets.kaizpatch.scan?.mods).toEqual([
        "com.github.Kai-Z-JP:KaizPatchX:v1.9.5",
      ]);
      expect(config.targets.mc1710.scan?.outputDir).toBe(path.join(root, "generated/mc1710"));
      expect(config.targets.mc1710.scan?.mods).toEqual([
        "curse.maven:ngtlib-288989:6505474",
        "curse.maven:realtrainmod-288988:6505479",
      ]);
      expect(config.targets.mc1710.typings).toEqual([
        `${path.join(root, "generated/mc1710")}/typings/*.d.ts`,
      ]);
      expect(config.targets.mc1710.mapping).toBe(
        `${path.join(root, "generated/mc1710")}/mappings/mcp-to-srg.json`
      );
      expect(config.targets.mc1122.scan?.outputDir).toBe(path.join(root, "generated/mc1122"));
      expect(config.targets.mc1122.scan?.mods).toEqual([
        "curse.maven:ngtlib-288989:4641592",
        "curse.maven:realtrainmod-288988:4641603",
      ]);
      expect(config.targets.mc1122.scan?.packages).toContain("net.minecraftforge.fml");
      expect(config.commonApiPolicy).toBe("allow");
      expect(config.commonApiManifest).toBe(path.join(root, "generated/common-api.json"));
      expect(config.commonApiTypingsDir).toBe(path.join(root, "generated/common/typings"));
      expect(config.commonSrcDir).toBe(path.join(root, "src/common"));
      expect(config.targets.mc1710.commonApiPolicy).toBe("allow");
      expect(config.targets.mc1710.commonApiManifest).toBe(
        path.join(root, "generated/common-api.json")
      );
      expect(config.entries).toEqual(["assets/minecraft/scripts/render_editor.ts"]);
      expect(config.targets.kaizpatch.wrapEntries).toEqual([
        "assets/minecraft/scripts/render_editor.ts",
      ]);
      expect(config.runtimeDispatch).toEqual([
        {
          target: "kaizpatch",
          condition: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('KaizPatch') !== -1",
        },
        {
          target: "mc1710",
          condition: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0",
        },
        { target: "mc1122", condition: "true" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
