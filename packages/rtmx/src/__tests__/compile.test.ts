import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.js";
import { compatModuleKey, compatModuleVarName, targetCompatOutputPath } from "../compatNames.js";
import { generateDispatchers } from "../multiTarget.js";

describe("compile", () => {
  it("通常文字列を Unicode escape にし、Unicode の相対 import は解決できる", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-unicode-"));
    try {
      const srcDir = path.join(root, "src");
      const outDir = path.join(root, "dist");
      mkdirSync(srcDir, { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        path.join(srcDir, "日本語.ts"),
        'export function helper() { return "値"; }\n',
        "utf-8"
      );
      writeFileSync(
        path.join(srcDir, "main.ts"),
        `import { helper } from "./日本語";
var normal = "日本語😀";
var template = \`日本語\`;
var fromModule = helper();
`,
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir,
          outDir,
          typings: [],
          mapping,
        })
      ).toBe(true);

      const helperJs = readFileSync(path.join(outDir, "日本語.js"), "utf-8");
      const mainJs = readFileSync(path.join(outDir, "main.js"), "utf-8");
      expect(helperJs).toContain('return "\\u5024"');
      expect(mainJs).toContain("//include <dist/日本語.js>");
      expect(mainJs).toContain('var normal = "\\u65E5\\u672C\\u8A9E\\uD83D\\uDE00"');
      expect(mainJs).toContain('var template = "\\u65E5\\u672C\\u8A9E"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("export 宣言は CommonJS のエクスポートではなく、 Nashorn のグローバル変数として出力される", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-compile-"));
    try {
      const srcDir = path.join(root, "src");
      const outDir = path.join(root, "dist");
      mkdirSync(srcDir, { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(path.join(srcDir, "lib.ts"), "export function helper() { return 1; }\n");
      writeFileSync(
        path.join(srcDir, "main.ts"),
        'import { helper } from "./lib";\nvar value = helper();\n',
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir,
          outDir,
          typings: [],
          mapping,
        })
      ).toBe(true);

      const libJs = readFileSync(path.join(outDir, "lib.js"), "utf-8");
      const mainJs = readFileSync(path.join(outDir, "main.js"), "utf-8");
      expect(libJs).toContain("function helper()");
      expect(libJs).not.toContain("exports.");
      expect(mainJs).toContain("//include <dist/lib.js>");
      expect(mainJs).not.toContain("require(");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("common build は @target を compat selector include に変換する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-common-"));
    try {
      const commonDir = path.join(root, "src/common");
      const outDir = path.join(root, "dist");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts"), { recursive: true });
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/render_editor.ts"),
        `import { helper } from "@target/assets/minecraft/scripts/lib/Compat";
import { helper as otherHelper } from "@target/assets/minecraft/scripts/lib/OtherCompat";
function render(entity: any, pass: number, par3: number): void {
  helper();
  otherHelper();
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        `export declare function helper(): void;
`,
        "utf-8"
      );
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/OtherCompat.compat.d.ts"),
        `export declare function helper(): void;
`,
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir: commonDir,
          srcDirs: [commonDir],
          outDir,
          typings: [],
          mapping,
          targetAliasDirs: [commonDir],
          commonOutDir: outDir,
        })
      ).toBe(true);

      const entryJs = readFileSync(
        path.join(outDir, "assets/minecraft/scripts/render_editor.js"),
        "utf-8"
      );
      const compatVar = compatModuleVarName("scripts/lib/Compat");
      const otherCompatVar = compatModuleVarName("scripts/lib/OtherCompat");
      expect(entryJs).toContain("//include <scripts/lib/Compat.compat.js>");
      expect(entryJs).toContain("//include <scripts/lib/OtherCompat.compat.js>");
      expect(entryJs).toContain(`${compatVar}.helper();`);
      expect(entryJs).toContain(`${otherCompatVar}.helper();`);
      expect(compatVar).not.toBe(otherCompatVar);
      expect(entryJs).not.toContain('require("@target/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("multi-target compat は target namespace に登録され、@common は共通出力を参照する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-multi-"));
    try {
      const commonDir = path.join(root, "src/common");
      const targetDir = path.join(root, "src/mc1122");
      const outDir = path.join(root, "dist/assets/minecraft/__targets__/mc1122");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts"), { recursive: true });
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/scripts/lib"), { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      const typings = path.join(root, "typings.d.ts");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        typings,
        `declare const Packages: any;
declare module "org.lwjgl.opengl" {
  export class GL11 {
    static glDisable(cap: number): void;
  }
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/render_editor.ts"),
        `import { helper } from "@target/assets/minecraft/scripts/lib/Compat";
function render(entity: any, pass: number, par3: number): void {
  helper();
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Shared.ts"),
        `export function commonHelper(): void {}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Compat.compat.ts"),
        `import { GL11 } from "org.lwjgl.opengl";
import { commonHelper } from "@common/assets/minecraft/scripts/lib/Shared";
import { targetHelper } from "./Other.compat";
export function helper(): void {
  commonHelper();
  targetHelper();
  GL11.glDisable(0);
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Other.compat.ts"),
        "export function targetHelper(): void {}\n",
        "utf-8"
      );
      const legacyCompatOutput = path.join(outDir, "scripts/lib/Compat.compat.js");
      mkdirSync(path.dirname(legacyCompatOutput), { recursive: true });
      writeFileSync(legacyCompatOutput, "legacy output\n", "utf-8");

      expect(
        compile({
          name: "test",
          srcDir: commonDir,
          srcDirs: [commonDir, targetDir],
          outDir,
          typings: [typings],
          mapping,
          targetName: "mc1122",
          commonOutDir: path.join(root, "dist"),
          wrapEntries: ["assets/minecraft/scripts/render_editor.ts"],
          lazyJavaImports: true,
        })
      ).toBe(true);

      const compatOutputPath = targetCompatOutputPath("scripts/lib/Compat", "mc1122");
      const compatJs = readFileSync(path.join(outDir, compatOutputPath), "utf-8");
      const otherCompatOutputPath = targetCompatOutputPath("scripts/lib/Other", "mc1122");
      expect(existsSync(legacyCompatOutput)).toBe(false);
      expect(existsSync(path.join(outDir, otherCompatOutputPath))).toBe(true);
      expect(compatJs).toContain(`//include <__targets__/mc1122/${otherCompatOutputPath}>`);
      expect(compatJs).not.toContain("scripts/lib/Other.compat.js");
      expect(existsSync(path.join(outDir, "scripts/render_editor.js"))).toBe(false);
      expect(compatJs).not.toContain("var GL11 = Packages.org.lwjgl.opengl.GL11;");
      expect(compatJs).toContain("//include <scripts/lib/Shared.js>");
      expect(compatJs).not.toContain('require("@common/');
      expect(compatJs).toContain("commonHelper();");
      expect(compatJs).toContain("Packages.org.lwjgl.opengl.GL11.glDisable(0)");
      expect(compatJs).toContain(
        `RTMX_COMPAT_TARGETS.mc1122.${compatModuleKey("scripts/lib/Compat")}.helper = helper;`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("target compat が common compat 宣言を満たさない場合は失敗する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-compat-contract-"));
    try {
      const commonDir = path.join(root, "src/common");
      const targetDir = path.join(root, "src/mc1122");
      const outDir = path.join(root, "dist/assets/minecraft/__targets__/mc1122");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/scripts/lib"), { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        `export declare class Compat {
  static helper(): void;
  static requiredByCommon(): void;
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Compat.compat.ts"),
        `export class Compat {
  static helper(): void {}
}
`,
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir: commonDir,
          srcDirs: [commonDir, targetDir],
          outDir,
          typings: [],
          mapping,
          targetName: "mc1122",
          commonSrcDir: commonDir,
        })
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compatFallbackTarget がある target compat は partial 実装を許可する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-compat-fallback-"));
    try {
      const commonDir = path.join(root, "src/common");
      const targetDir = path.join(root, "src/kaizpatch");
      const outDir = path.join(root, "dist/assets/minecraft/__targets__/kaizpatch");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/scripts/lib"), { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        `export declare class Compat {
  static helper(): void;
  static requiredByCommon(): void;
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Compat.compat.ts"),
        `export class Compat {
  static helper(): void {}
}
`,
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir: commonDir,
          srcDirs: [commonDir, targetDir],
          outDir,
          typings: [],
          mapping,
          targetName: "kaizpatch",
          commonSrcDir: commonDir,
          compatFallbackTarget: "mc1710",
        })
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compatFallbackTarget があっても実装済みメンバーの型違いは失敗する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-compat-fallback-type-"));
    try {
      const commonDir = path.join(root, "src/common");
      const targetDir = path.join(root, "src/kaizpatch");
      const outDir = path.join(root, "dist/assets/minecraft/__targets__/kaizpatch");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      mkdirSync(path.join(targetDir, "assets/minecraft/scripts/lib"), { recursive: true });

      const mapping = path.join(root, "mcp-to-srg.json");
      writeFileSync(mapping, JSON.stringify({ classes: {} }), "utf-8");
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        `export declare class Compat {
  static helper(): number;
  static requiredByCommon(): void;
}
`,
        "utf-8"
      );
      writeFileSync(
        path.join(targetDir, "assets/minecraft/scripts/lib/Compat.compat.ts"),
        `export class Compat {
  static helper(): string {
    return "wrong";
  }
}
`,
        "utf-8"
      );

      expect(
        compile({
          name: "test",
          srcDir: commonDir,
          srcDirs: [commonDir, targetDir],
          outDir,
          typings: [],
          mapping,
          targetName: "kaizpatch",
          commonSrcDir: commonDir,
          compatFallbackTarget: "mc1710",
        })
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compat selector は選択された target 実装だけを遅延 include する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-dispatch-"));
    try {
      const outDir = path.join(root, "dist");
      const commonDir = path.join(root, "src/common");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        "export declare function helper(): void;\n",
        "utf-8"
      );
      for (const target of ["mc1710", "mc1122"]) {
        const targetCompat = path.join(
          outDir,
          "assets/minecraft/__targets__",
          target,
          targetCompatOutputPath("scripts/lib/Compat", target)
        );
        mkdirSync(path.dirname(targetCompat), { recursive: true });
        writeFileSync(
          targetCompat,
          `RTMX_COMPAT_TARGETS.${target} = {};
RTMX_COMPAT_TARGETS.${target}.${compatModuleKey("scripts/lib/Compat")} = { helper: function () {} };
`,
          "utf-8"
        );
      }

      generateDispatchers({
        name: "test",
        outDir,
        commonSrcDir: commonDir,
        commonApiManifest: path.join(root, "generated/common-api.json"),
        commonApiTypingsDir: path.join(root, "generated/common/typings"),
        commonApiPolicy: "allow",
        entries: ["assets/minecraft/scripts/render_editor.ts"],
        runtimeDispatch: [
          {
            target: "mc1710",
            condition: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0",
          },
          { target: "mc1122", condition: "true" },
        ],
        targets: {
          mc1710: {
            name: "test",
            srcDir: "",
            outDir: path.join(outDir, "assets/minecraft/__targets__/mc1710"),
            typings: [],
            mapping: "",
          },
          mc1122: {
            name: "test",
            srcDir: "",
            outDir: path.join(outDir, "assets/minecraft/__targets__/mc1122"),
            typings: [],
            mapping: "",
          },
        },
      });

      const selector = readFileSync(
        path.join(outDir, "assets/minecraft/scripts/lib/Compat.compat.js"),
        "utf-8"
      );
      const compatKey = compatModuleKey("scripts/lib/Compat");
      const mc1710CompatPath = targetCompatOutputPath("scripts/lib/Compat", "mc1710");
      const mc1122CompatPath = targetCompatOutputPath("scripts/lib/Compat", "mc1122");
      expect(selector).toContain(
        `function RTMX_loadCompatTarget_mc1710_${compatKey}() {\n  if (!(RTMX_COMPAT_TARGETS.mc1710 && RTMX_COMPAT_TARGETS.mc1710.${compatKey})) {\n    //include <__targets__/mc1710/${mc1710CompatPath}>\n  }\n  return (RTMX_COMPAT_TARGETS.mc1710 && RTMX_COMPAT_TARGETS.mc1710.${compatKey});\n}`
      );
      expect(selector).toContain(
        `function RTMX_loadCompatTarget_mc1122_${compatKey}() {\n  if (!(RTMX_COMPAT_TARGETS.mc1122 && RTMX_COMPAT_TARGETS.mc1122.${compatKey})) {\n    //include <__targets__/mc1122/${mc1122CompatPath}>\n  }\n  return (RTMX_COMPAT_TARGETS.mc1122 && RTMX_COMPAT_TARGETS.mc1122.${compatKey});\n}`
      );
      expect(path.basename(mc1710CompatPath)).not.toBe(path.basename(mc1122CompatPath));
      expect(path.basename(mc1710CompatPath)).not.toBe("Compat.compat.js");
      expect(
        new Set([
          path.basename(targetCompatOutputPath("scripts/a/Compat", "mc1710")),
          path.basename(targetCompatOutputPath("scripts/b/Compat", "mc1710")),
          path.basename(targetCompatOutputPath("scripts/a/Compat", "mc1122")),
        ]).size
      ).toBe(3);
      expect(selector).toContain(`function RTMX_selectCompatTarget_${compatKey}()`);
      expect(selector).toContain(
        "if (Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0) {"
      );
      expect(selector).toContain("else if (true) {");
      expect(selector).toContain(
        `else {\n    return RTMX_loadCompatTarget_mc1710_${compatKey}();\n  }`
      );
      expect(selector).toContain(
        `var ${compatModuleVarName("scripts/lib/Compat")} = RTMX_selectCompatTarget_${compatKey}();`
      );
      expect(selector).not.toContain("var helper =");
      expect(selector).not.toContain(".apply(");
      expect(selector).not.toContain("arguments");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compat selector は target の未実装メンバーを fallback target で埋める", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rtmx-dispatch-fallback-"));
    try {
      const outDir = path.join(root, "dist");
      const commonDir = path.join(root, "src/common");
      const compatKey = compatModuleKey("scripts/lib/Compat");
      mkdirSync(path.join(commonDir, "assets/minecraft/scripts/lib"), { recursive: true });
      writeFileSync(
        path.join(commonDir, "assets/minecraft/scripts/lib/Compat.compat.d.ts"),
        `export declare class Compat {
  static targetName(): string;
  static requiredByCommon(): void;
}
`,
        "utf-8"
      );

      const kaizpatchCompat = path.join(
        outDir,
        "assets/minecraft/__targets__/kaizpatch",
        targetCompatOutputPath("scripts/lib/Compat", "kaizpatch")
      );
      mkdirSync(path.dirname(kaizpatchCompat), { recursive: true });
      writeFileSync(
        kaizpatchCompat,
        `RTMX_COMPAT_TARGETS.kaizpatch = {};
RTMX_COMPAT_TARGETS.kaizpatch.${compatKey} = { Compat: { targetName: function () { return "kaizpatch"; } } };
`,
        "utf-8"
      );

      const mc1710Compat = path.join(
        outDir,
        "assets/minecraft/__targets__/mc1710",
        targetCompatOutputPath("scripts/lib/Compat", "mc1710")
      );
      mkdirSync(path.dirname(mc1710Compat), { recursive: true });
      writeFileSync(
        mc1710Compat,
        `RTMX_COMPAT_TARGETS.mc1710 = {};
RTMX_COMPAT_TARGETS.mc1710.${compatKey} = { Compat: { requiredByCommon: function () {} } };
`,
        "utf-8"
      );

      generateDispatchers({
        name: "test",
        outDir,
        commonSrcDir: commonDir,
        commonApiManifest: path.join(root, "generated/common-api.json"),
        commonApiTypingsDir: path.join(root, "generated/common/typings"),
        commonApiPolicy: "allow",
        entries: ["assets/minecraft/scripts/render_editor.ts"],
        runtimeDispatch: [
          { target: "kaizpatch", condition: "true" },
          {
            target: "mc1710",
            condition: "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0",
          },
        ],
        targets: {
          kaizpatch: {
            name: "test",
            srcDir: "",
            outDir: path.join(outDir, "assets/minecraft/__targets__/kaizpatch"),
            typings: [],
            mapping: "",
            compatFallbackTarget: "mc1710",
          },
          mc1710: {
            name: "test",
            srcDir: "",
            outDir: path.join(outDir, "assets/minecraft/__targets__/mc1710"),
            typings: [],
            mapping: "",
          },
        },
      });

      const selector = readFileSync(
        path.join(outDir, "assets/minecraft/scripts/lib/Compat.compat.js"),
        "utf-8"
      );
      expect(selector).toContain("function RTMX_mergeCompatTarget(target, fallback)");
      expect(selector).toContain(
        `return RTMX_mergeCompatTarget(RTMX_loadCompatTarget_kaizpatch_${compatKey}(), RTMX_loadCompatTarget_mc1710_${compatKey}());`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
