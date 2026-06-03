import * as fs from "fs";
import * as path from "path";
import type { MultiTargetConfig } from "./config.js";
import { stripMinecraftAssetPrefix } from "./compile.js";
import { compatModuleKey, compatModuleVarName, compatSelectFunctionName } from "./compatNames.js";

export function generateDispatchers(config: MultiTargetConfig): void {
  generateCompatSelectors(config);
}

export function generateCompatSelectors(config: MultiTargetConfig): void {
  const commonSrcDir = config.commonSrcDir;
  if (!commonSrcDir) return;

  for (const declarationPath of collectCompatDeclarations(commonSrcDir)) {
    const rel = path.relative(commonSrcDir, declarationPath).replace(/\\/g, "/");
    const modulePath = stripMinecraftAssetPrefix(rel).replace(/\.compat\.d\.ts$/, "");
    const selectorPath = path.join(config.outDir, "assets/minecraft", `${modulePath}.compat.js`);
    fs.mkdirSync(path.dirname(selectorPath), { recursive: true });

    const moduleKey = compatModuleKey(modulePath);
    const moduleVarName = compatModuleVarName(modulePath);
    const selectFunctionName = compatSelectFunctionName(modulePath);
    const lines: string[] = [];
    lines.push("var RTMX_COMPAT_TARGETS = RTMX_COMPAT_TARGETS || {};");
    for (const [targetName, target] of Object.entries(config.targets)) {
      const targetCompatPath = path.join(target.outDir, `${modulePath}.compat.js`);
      lines.push(`function ${compatLoadFunctionName(targetName, moduleKey)}() {`);
      if (fs.existsSync(targetCompatPath)) {
        lines.push(`  if (!${targetModuleExpression(targetName, moduleKey)}) {`);
        lines.push(`    //include <${toIncludePath(selectorPath, targetCompatPath)}>`);
        lines.push("  }");
      }
      lines.push(`  return ${targetModuleExpression(targetName, moduleKey)};`);
      lines.push("}");
    }
    lines.push("");
    if (hasCompatFallback(config)) {
      lines.push(...compatFallbackHelperLines(), "");
    }
    lines.push(`function ${selectFunctionName}() {`);
    const fallbackTarget = Object.keys(config.targets)[0];
    if (config.runtimeDispatch.length === 0) {
      lines.push(`  return ${compatTargetExpression(config, fallbackTarget, moduleKey)};`);
    } else {
      for (const [index, rule] of config.runtimeDispatch.entries()) {
        const keyword = index === 0 ? "if" : "else if";
        lines.push(`  ${keyword} (${rule.condition}) {`);
        lines.push(`    return ${compatTargetExpression(config, rule.target, moduleKey)};`);
        lines.push("  }");
      }
      lines.push("  else {");
      lines.push(`    return ${compatTargetExpression(config, fallbackTarget, moduleKey)};`);
      lines.push("  }");
    }
    lines.push("}");
    lines.push("");
    lines.push(`var ${moduleVarName} = ${selectFunctionName}();`);
    lines.push("");

    fs.writeFileSync(selectorPath, lines.join("\n"), "utf-8");
  }
}

function compatTargetExpression(
  config: MultiTargetConfig,
  targetName: string,
  moduleKey: string,
  seen = new Set<string>()
): string {
  const moduleExpression = `${compatLoadFunctionName(targetName, moduleKey)}()`;
  const fallbackTarget = config.targets[targetName]?.compatFallbackTarget;
  if (!fallbackTarget || seen.has(targetName)) return moduleExpression;
  seen.add(targetName);
  return `RTMX_mergeCompatTarget(${moduleExpression}, ${compatTargetExpression(
    config,
    fallbackTarget,
    moduleKey,
    seen
  )})`;
}

function targetModuleExpression(targetName: string, moduleKey: string): string {
  const targetExpression = `RTMX_COMPAT_TARGETS.${targetName}`;
  return `(${targetExpression} && ${targetExpression}.${moduleKey})`;
}

function compatLoadFunctionName(targetName: string, moduleKey: string): string {
  return `RTMX_loadCompatTarget_${safeIdentifierPart(targetName)}_${moduleKey}`;
}

function safeIdentifierPart(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^([^A-Za-z_$])/, "_$1")
    .replace(/_+$/g, "");
  return safe || "target";
}

function hasCompatFallback(config: MultiTargetConfig): boolean {
  return Object.values(config.targets).some((target) => !!target.compatFallbackTarget);
}

function compatFallbackHelperLines(): string[] {
  return [
    "function RTMX_mergeCompatTarget(target, fallback) {",
    "  if (target == null) return fallback;",
    "  if (fallback == null) return target;",
    "  for (var key in fallback) {",
    "    if (target[key] == null) {",
    "      target[key] = fallback[key];",
    "    } else {",
    "      RTMX_mergeCompatValue(target[key], fallback[key]);",
    "    }",
    "  }",
    "  return target;",
    "}",
    "",
    "function RTMX_mergeCompatValue(target, fallback) {",
    "  if (target == null || fallback == null) return;",
    '  if (typeof target !== "object" && typeof target !== "function") return;',
    '  if (typeof fallback !== "object" && typeof fallback !== "function") return;',
    "  for (var key in fallback) {",
    '    if (key === "prototype") continue;',
    "    if (target[key] == null) target[key] = fallback[key];",
    "  }",
    "  if (target.prototype && fallback.prototype) {",
    "    for (var protoKey in fallback.prototype) {",
    "      if (target.prototype[protoKey] == null) target.prototype[protoKey] = fallback.prototype[protoKey];",
    "    }",
    "  }",
    "}",
  ];
}

function collectCompatDeclarations(commonSrcDir: string): string[] {
  const results: string[] = [];
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.name.endsWith(".compat.d.ts")) {
        results.push(full);
      }
    }
  };
  visit(commonSrcDir);
  return results.sort();
}

function toIncludePath(selectorPath: string, targetCompatPath: string): string {
  const mcBase = resolveMcBase(selectorPath);
  return path.relative(mcBase, targetCompatPath).replace(/\\/g, "/");
}

function resolveMcBase(outputFile: string): string {
  const abs = path.resolve(outputFile).replace(/\\/g, "/");
  const idx = abs.indexOf("/assets/minecraft/");
  if (idx >= 0) return abs.slice(0, idx + "/assets/minecraft".length);
  return path.dirname(path.resolve(outputFile));
}
