import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.js";

describe("compile", () => {
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
});
