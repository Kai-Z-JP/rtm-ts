import ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { RtmxConfig } from "./config.js";
import { loadMappings } from "./mappings.js";
import { printDiagnostics } from "./diagnostics.js";
import { createJavaImportTransformer } from "./transformers/javaImportToPackages.js";
import { createMcpToSrgTransformer } from "./transformers/mcpToSrg.js";
import { createNashornCompatTransformer } from "./transformers/nashornCompat.js";
import { createRendererClassTransformer } from "./transformers/rendererClass.js";

export function compile(config: RtmxConfig): boolean {
  const mappings = loadMappings(config.mapping);

  // src 以下の .ts を収集
  const srcFiles = collectTs(config.srcDir);
  const expandedTypings = config.typings.flatMap(expandGlob);

  const allFiles = [...expandedTypings, ...srcFiles];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    lib: ["lib.es5.d.ts"],
    strict: true,
    noEmitOnError: true,
    skipLibCheck: true,
    ...config.compilerOptions,
    // commonjs で TypeChecker を動かし、出力時に require ボイラープレートを除去する。
    // rtmx.json の module 指定は無視する。
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  };

  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram(allFiles, compilerOptions, host);
  const checker = program.getTypeChecker();

  const tsDiagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

  const rtmDiagnostics: ts.Diagnostic[] = [];

  const transformers: ts.CustomTransformers = {
    before: [
      createStripExportsTransformer(),
      createRendererClassTransformer(checker),
      createNashornCompatTransformer(rtmDiagnostics),
      createJavaImportTransformer(checker, rtmDiagnostics),
      createMcpToSrgTransformer(checker, mappings, rtmDiagnostics),
    ],
  };

  const emitResult = program.emit(
    undefined,
    (fileName, text) => {
      const rel = path.relative(config.srcDir, fileName.replace(/\.js$/, ".ts"));
      const outPath = path.join(config.outDir, rel.replace(/\.ts$/, ".js"));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, stripModuleBoilerplate(text, outPath, config.outDir), "utf-8");
    },
    undefined,
    false,
    transformers
  );

  const allDiagnostics = [...tsDiagnostics, ...emitResult.diagnostics, ...rtmDiagnostics];

  printDiagnostics(allDiagnostics);

  const hasError = allDiagnostics.some((d) => d.category === ts.DiagnosticCategory.Error);

  return !hasError;
}

/**
 * TypeScript の CJS emit output を Nashorn-clean な JS に変換する。
 *
 * 1. `var X_1 = require("java.module")` を除去・収集
 * 2. X_1.ClassName の使用箇所を収集し `var ClassName = Packages.java.module.ClassName;` を生成
 * 3. X_1.ClassName → ClassName に置換
 * 4. CommonJS module boilerplate を除去
 */
function resolveMcBase(outputFile: string, outDir: string): string {
  const abs = path.resolve(outputFile).replace(/\\/g, "/");
  const idx = abs.indexOf("/assets/minecraft/");
  if (idx >= 0) return abs.slice(0, idx + "/assets/minecraft".length);
  // fallback: outDir の親
  return path.dirname(path.resolve(outDir));
}

function stripModuleBoilerplate(text: string, outputFile: string, outDir: string): string {
  const mcBase = resolveMcBase(outputFile, outDir);
  text = text.replace(/^require\("(\.\.?\/[^"]+)"\);\r?\n/gm, (_, relImport: string) => {
    const resolved = path.resolve(path.dirname(outputFile), relImport + ".js");
    const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
    return `//include <${includePath}>\n`;
  });

  const requireMap = new Map<string, string>();

  const includeVars = new Set<string>(); // 相対 require の varName

  text = text.replace(
    /^(?:var|const|let) (\w+) = require\("([^"]+)"\);\r?\n/gm,
    (whole, varName: string, moduleName: string) => {
      if (moduleName.startsWith(".")) {
        // 相対 require → //include に変換
        const resolved = path.resolve(path.dirname(outputFile), moduleName + ".js");
        const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
        includeVars.add(varName);
        return `//include <${includePath}>\n`;
      }
      if (moduleName.includes(".")) {
        // Java パッケージ
        requireMap.set(varName, moduleName);
        return "";
      }
      return whole;
    }
  );

  for (const varName of includeVars) {
    text = text.replace(new RegExp(`\\b${varName}\\.(\\w+)`, "g"), (_, member) => member);
  }

  const varDecls: string[] = [];
  for (const [varName, moduleName] of requireMap) {
    const used = new Set<string>();
    const re = new RegExp(`\\b${varName}\\.(\\w+)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      used.add(m[1]);
    }
    for (const cls of used) {
      varDecls.push(`var ${cls} = Packages.${moduleName}.${cls};`);
    }

    text = text.replace(new RegExp(`\\b${varName}\\.(\\w+)`, "g"), (_, cls) => cls);
  }

  text = text
    .replace(/^"use strict";\r?\n/m, "")
    .replace(/^Object\.defineProperty\(exports,\s*"__esModule",\s*\{[^}]*\}\);\r?\n/m, "")
    .replace(/^exports\.\w+\s*=\s*void 0;\r?\n/gm, "")
    .trimStart();

  if (varDecls.length > 0) {
    text = varDecls.join("\n") + "\n" + text;
  }

  return text;
}

function createStripExportsTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const stripExportModifier = (modifiers?: ts.NodeArray<ts.ModifierLike>) => {
      const next = modifiers?.filter(
        (modifier) =>
          !ts.isModifier(modifier) ||
          (modifier.kind !== ts.SyntaxKind.ExportKeyword &&
            modifier.kind !== ts.SyntaxKind.DefaultKeyword)
      );
      return next && next.length > 0 ? next : undefined;
    };

    const visit: ts.Visitor = (node) => {
      if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
        return undefined;
      }

      if (ts.canHaveModifiers(node)) {
        const modifiers = ts.getModifiers(node);
        if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          if (ts.isFunctionDeclaration(node)) {
            return ts.factory.updateFunctionDeclaration(
              node,
              stripExportModifier(node.modifiers),
              node.asteriskToken,
              node.name,
              node.typeParameters,
              node.parameters,
              node.type,
              node.body
            );
          }
          if (ts.isClassDeclaration(node)) {
            return ts.factory.updateClassDeclaration(
              node,
              stripExportModifier(node.modifiers),
              node.name,
              node.typeParameters,
              node.heritageClauses,
              node.members
            );
          }
          if (ts.isVariableStatement(node)) {
            return ts.factory.updateVariableStatement(
              node,
              stripExportModifier(node.modifiers),
              node.declarationList
            );
          }
          if (ts.isEnumDeclaration(node)) {
            return ts.factory.updateEnumDeclaration(
              node,
              stripExportModifier(node.modifiers),
              node.name,
              node.members
            );
          }
        }
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (sourceFile) => ts.visitEachChild(sourceFile, visit, context);
  };
}

function expandGlob(pattern: string): string[] {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!base.includes("*")) return fs.existsSync(pattern) ? [pattern] : [];
  const ext = base.replace(/\*/g, "");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTs(full));
    } else if (entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}
