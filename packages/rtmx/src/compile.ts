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
import { createUnicodeEscapeTransformer } from "./transformers/unicodeEscape.js";
import { collectCommonApiDiagnostics } from "./commonApi.js";
import { compatModuleKey, compatModuleVarName } from "./compatNames.js";

export function compile(config: RtmxConfig): boolean {
  const mappings = loadMappings(config.mapping);

  const srcDirs = config.srcDirs?.length ? config.srcDirs : [config.srcDir];
  // src 以下の .ts を収集
  const srcFiles = srcDirs.flatMap(collectTs);
  const expandedTypings = config.typings.flatMap(expandGlob);
  const syntheticSourceFiles = createCompatContractCheckFiles(config, srcDirs);
  const syntheticSourceText = new Map(
    syntheticSourceFiles.map((file) => [path.resolve(file.fileName), file.text])
  );
  const syntheticFileNames = new Set(syntheticSourceText.keys());

  const allFiles = [
    ...expandedTypings,
    ...srcFiles,
    ...syntheticSourceFiles.map((f) => f.fileName),
  ];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    lib: ["lib.es5.d.ts"],
    downlevelIteration: true,
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
  installSyntheticSourceFiles(host, syntheticSourceText);
  installMultiRootModuleResolution(host, compilerOptions, {
    srcDirs,
    targetAliasDirs: config.targetAliasDirs,
  });
  const program = ts.createProgram(allFiles, compilerOptions, host);
  const checker = program.getTypeChecker();

  const tsDiagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

  const rtmDiagnostics: ts.Diagnostic[] = config.targetName
    ? []
    : collectCommonApiDiagnostics(program, checker, config);

  const transformers: ts.CustomTransformers = {
    before: [
      createStripExportsTransformer(),
      createRendererClassTransformer(checker),
      createNashornCompatTransformer(rtmDiagnostics),
      createJavaImportTransformer(checker, rtmDiagnostics),
      createMcpToSrgTransformer(checker, mappings, rtmDiagnostics),
      createUnicodeEscapeTransformer(),
    ],
  };

  const emitResult = program.emit(
    undefined,
    (fileName, text) => {
      const sourceTs = fileName.replace(/\.js$/, ".ts");
      if (syntheticFileNames.has(path.resolve(sourceTs))) {
        return;
      }
      const sourceRootIndex = getSourceRootIndex(sourceTs, srcDirs);
      if (config.targetName && srcDirs.length > 1 && sourceRootIndex === 0) {
        return;
      }

      const rel = getRelativeSourcePath(sourceTs, srcDirs);
      const outputRel = config.targetName ? stripMinecraftAssetPrefix(rel) : rel;
      const outPath = path.join(config.outDir, outputRel.replace(/\.ts$/, ".js"));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      let output = stripModuleBoilerplate(text, outPath, config.outDir, {
        lazyJavaImports: config.lazyJavaImports ?? false,
        targetOutDir: config.targetName ? config.outDir : undefined,
        commonOutDir: config.commonOutDir,
      });
      if (config.targetName && rel.replace(/\\/g, "/").endsWith(".compat.ts")) {
        output = registerTargetCompatModule(output, sourceTs, config.targetName, rel);
      }
      if (config.targetName && isWrappedEntry(rel, config.wrapEntries ?? [])) {
        output = wrapTargetEntry(output, config.targetName);
      }
      fs.writeFileSync(outPath, output, "utf-8");
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

interface SyntheticSourceFile {
  fileName: string;
  text: string;
}

function createCompatContractCheckFiles(
  config: RtmxConfig,
  srcDirs: string[]
): SyntheticSourceFile[] {
  if (!config.targetName || !config.commonSrcDir) return [];

  const commonSrcDir = path.resolve(config.commonSrcDir);
  const targetSrcDirs = srcDirs.filter((dir) => path.resolve(dir) !== commonSrcDir);
  if (targetSrcDirs.length === 0) return [];

  const declarations = collectCompatDeclarations(commonSrcDir);
  if (declarations.length === 0) return [];

  const allowPartialImplementation = !!config.compatFallbackTarget;
  const fileName = path.join(config.outDir, `.rtmx-compat-contracts.${config.targetName}.ts`);
  const fileDir = path.dirname(fileName);
  const lines: string[] = [];
  if (allowPartialImplementation) {
    lines.push(
      "type RTMX_CompatPartial<T> = { [K in keyof T]?: T[K] extends (...args: any[]) => any ? T[K] : T[K] extends object ? RTMX_CompatPartial<T[K]> : T[K] };",
      ""
    );
  }
  lines.push(
    ...declarations.flatMap((declarationPath, index) => {
      const rel = path.relative(commonSrcDir, declarationPath);
      const targetCompatPath = resolveTargetCompatPath(targetSrcDirs, rel);
      if (allowPartialImplementation && !fs.existsSync(`${targetCompatPath}.ts`)) {
        return [];
      }
      const contractPath = declarationPath.replace(/\.d\.ts$/, "");
      const contractImport = toModuleSpecifier(fileDir, contractPath);
      const implementationImport = toModuleSpecifier(fileDir, targetCompatPath);
      const contractName = `rtmxCompatContract${index}`;
      const implementationName = `rtmxCompatImplementation${index}`;
      const checkName = `rtmxCompatCheck${index}`;
      const contractType = allowPartialImplementation
        ? `RTMX_CompatPartial<typeof ${contractName}>`
        : `typeof ${contractName}`;

      return [
        `import * as ${contractName} from "${contractImport}";`,
        `import * as ${implementationName} from "${implementationImport}";`,
        `const ${checkName}: ${contractType} = ${implementationName};`,
        `void ${checkName};`,
        "",
      ];
    })
  );

  return [{ fileName, text: lines.join("\n") }];
}

function resolveTargetCompatPath(targetSrcDirs: string[], declarationRelPath: string): string {
  const candidates = targetSrcDirs.map((dir) =>
    path.join(dir, declarationRelPath).replace(/\.compat\.d\.ts$/, ".compat")
  );
  return candidates.find((candidate) => fs.existsSync(`${candidate}.ts`)) ?? candidates[0];
}

function installSyntheticSourceFiles(
  host: ts.CompilerHost,
  sourceFiles: Map<string, string>
): void {
  if (sourceFiles.size === 0) return;

  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = (fileName) =>
    sourceFiles.has(path.resolve(fileName)) || baseFileExists(fileName);
  host.readFile = (fileName) => sourceFiles.get(path.resolve(fileName)) ?? baseReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = sourceFiles.get(path.resolve(fileName));
    if (text !== undefined) {
      return ts.createSourceFile(fileName, text, languageVersion, true);
    }
    return baseGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
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

function toModuleSpecifier(fromDir: string, modulePath: string): string {
  const rel = path.relative(fromDir, modulePath).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function getRelativeSourcePath(fileName: string, srcDirs: string[]): string {
  const normalized = path.resolve(fileName);
  const matches = srcDirs
    .map((dir) => path.resolve(dir))
    .filter((dir) => isInsideDir(normalized, dir))
    .sort((a, b) => b.length - a.length);
  return path.relative(matches[0] ?? srcDirs[0], normalized);
}

function isInsideDir(fileName: string, dir: string): boolean {
  const rel = path.relative(dir, fileName);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function installMultiRootModuleResolution(
  host: ts.CompilerHost,
  compilerOptions: ts.CompilerOptions,
  options: { srcDirs: string[]; targetAliasDirs?: string[] }
): void {
  const { srcDirs } = options;
  const targetAliasDirs = options.targetAliasDirs ?? srcDirs.slice(1);

  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (moduleName.startsWith("@target/")) {
        for (const root of targetAliasDirs) {
          const candidate = path.resolve(root, moduleName.slice("@target/".length));
          const candidateFile = resolveTsModuleFile(candidate);
          if (candidateFile) {
            return {
              resolvedFileName: candidateFile,
              extension: ts.Extension.Ts,
              isExternalLibraryImport: false,
            };
          }
        }
      }

      if (moduleName.startsWith("@common/")) {
        const candidate = path.resolve(srcDirs[0], moduleName.slice("@common/".length));
        const candidateFile = resolveTsModuleFile(candidate);
        if (candidateFile) {
          return {
            resolvedFileName: candidateFile,
            extension: ts.Extension.Ts,
            isExternalLibraryImport: false,
          };
        }
      }

      const containingRoot = srcDirs.find((dir) =>
        isInsideDir(path.resolve(containingFile), path.resolve(dir))
      );
      if (moduleName.startsWith(".") && containingRoot) {
        const relContainingDir = path.relative(containingRoot, path.dirname(containingFile));
        for (const root of srcDirs) {
          if (path.resolve(root) === path.resolve(containingRoot)) continue;
          const candidate = path.resolve(root, relContainingDir, moduleName);
          const candidateFile = resolveTsModuleFile(candidate);
          if (candidateFile) {
            return {
              resolvedFileName: candidateFile,
              extension: ts.Extension.Ts,
              isExternalLibraryImport: false,
            };
          }
        }
      }

      return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule;
    });
}

function resolveTsModuleFile(basePath: string): string | undefined {
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.compat.ts`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.compat.ts"),
    `${basePath}.compat.d.ts`,
    `${basePath}.d.ts`,
    path.join(basePath, "index.compat.d.ts"),
    path.join(basePath, "index.d.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
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

function stripModuleBoilerplate(
  text: string,
  outputFile: string,
  outDir: string,
  options: { lazyJavaImports?: boolean; targetOutDir?: string; commonOutDir?: string } = {}
): string {
  const mcBase = resolveMcBase(outputFile, outDir);
  text = text.replace(/^require\("(\.\.?\/[^"]+)"\);\r?\n/gm, (_, relImport: string) => {
    const resolved = path.resolve(path.dirname(outputFile), relImport + ".js");
    const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
    return `//include <${includePath}>\n`;
  });

  const requireMap = new Map<string, string>();

  const includeVars = new Map<string, string | undefined>(); // require の varName -> namespace prefix

  text = text.replace(
    /^(?:var|const|let) (\w+) = require\("([^"]+)"\);\r?\n/gm,
    (whole, varName: string, moduleName: string) => {
      if (moduleName.startsWith(".")) {
        // 相対 require → //include に変換
        const resolved = path.resolve(path.dirname(outputFile), moduleName + ".js");
        const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
        includeVars.set(varName, undefined);
        return `//include <${includePath}>\n`;
      }
      if (moduleName.startsWith("@target/") && options.targetOutDir) {
        const modulePath = stripMinecraftAssetPrefix(moduleName.slice("@target/".length));
        const resolved =
          resolveCompiledTargetModule(options.targetOutDir, modulePath) ??
          path.resolve(options.targetOutDir, modulePath + ".js");
        const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
        includeVars.set(varName, undefined);
        return `//include <${includePath}>\n`;
      }
      if (moduleName.startsWith("@target/") && options.commonOutDir) {
        const modulePath = stripMinecraftAssetPrefix(moduleName.slice("@target/".length));
        const resolved = resolveCompiledCommonModule(
          options.commonOutDir,
          modulePath,
          ".compat.js"
        );
        const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
        includeVars.set(varName, compatModuleVarName(modulePath));
        return `//include <${includePath}>\n`;
      }
      if (moduleName.startsWith("@common/") && options.targetOutDir) {
        const modulePath = stripMinecraftAssetPrefix(moduleName.slice("@common/".length));
        const resolved =
          (options.commonOutDir
            ? resolveCompiledCommonModule(options.commonOutDir, modulePath, ".js")
            : undefined) ??
          resolveCompiledTargetModule(options.targetOutDir, modulePath) ??
          path.resolve(options.targetOutDir, modulePath + ".js");
        const includePath = path.relative(mcBase, resolved).replace(/\\/g, "/");
        includeVars.set(varName, undefined);
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

  for (const [varName, namespace] of includeVars) {
    text = text.replace(
      new RegExp(`\\(0,\\s*${varName}\\.(\\w+)\\)`, "g"),
      (_, member) => `${namespace ? `${namespace}.` : ""}${member}`
    );
    text = text.replace(
      new RegExp(`\\b${varName}\\.(\\w+)`, "g"),
      (_, member) => `${namespace ? `${namespace}.` : ""}${member}`
    );
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
      if (!options.lazyJavaImports) {
        varDecls.push(`var ${cls} = Packages.${moduleName}.${cls};`);
      }
    }

    text = text.replace(new RegExp(`\\b${varName}\\.(\\w+)`, "g"), (_, cls) =>
      options.lazyJavaImports ? `Packages.${moduleName}.${cls}` : cls
    );
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

function resolveCompiledTargetModule(targetOutDir: string, modulePath: string): string | undefined {
  const basePath = path.resolve(targetOutDir, modulePath);
  const candidates = [
    `${basePath}.js`,
    `${basePath}.compat.js`,
    path.join(basePath, "index.js"),
    path.join(basePath, "index.compat.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveCompiledCommonModule(
  commonOutDir: string,
  modulePath: string,
  extension: ".js" | ".compat.js"
): string {
  return path.resolve(commonOutDir, "assets/minecraft", modulePath + extension);
}

function isWrappedEntry(relPath: string, entries: string[]): boolean {
  const normalizedRel = relPath.replace(/\\/g, "/");
  return entries.some((entry) => entry.replace(/\\/g, "/") === normalizedRel);
}

export function stripMinecraftAssetPrefix(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  return normalized.startsWith("assets/minecraft/")
    ? normalized.slice("assets/minecraft/".length)
    : normalized;
}

function wrapTargetEntry(text: string, targetName: string): string {
  const callbacks = collectTopLevelFunctions(text);
  const returnBody = callbacks.map((name) => `${name}: ${name}`).join(", ");
  return [
    "var RTMX_TARGETS = RTMX_TARGETS || {};",
    `RTMX_TARGETS.${targetName} = (function () {`,
    indent(text.trim()),
    `return { ${returnBody} };`,
    "})();",
    "",
  ].join("\n");
}

function collectTopLevelFunctions(text: string): string[] {
  const result: string[] = [];
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    result.push(match[1]);
  }
  return result;
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

function getSourceRootIndex(fileName: string, srcDirs: string[]): number {
  const normalized = path.resolve(fileName);
  const matches = srcDirs
    .map((dir, index) => ({ dir: path.resolve(dir), index }))
    .filter(({ dir }) => isInsideDir(normalized, dir))
    .sort((a, b) => b.dir.length - a.dir.length);
  return matches[0]?.index ?? -1;
}

function registerTargetCompatModule(
  text: string,
  sourceTs: string,
  targetName: string,
  relPath: string
): string {
  const exportedNames = collectExportedNames(sourceTs);
  if (exportedNames.length === 0) return text;
  const split = splitIncludeDirectives(text.trimEnd());
  const modulePath = stripMinecraftAssetPrefix(relPath.replace(/\\/g, "/")).replace(
    /\.compat\.ts$/,
    ""
  );
  const moduleKey = compatModuleKey(modulePath);
  return [
    ...split.includes,
    "(function () {",
    indent(split.body.trim()),
    indent(
      [
        `RTMX_COMPAT_TARGETS.${targetName} = RTMX_COMPAT_TARGETS.${targetName} || {};`,
        `RTMX_COMPAT_TARGETS.${targetName}.${moduleKey} = RTMX_COMPAT_TARGETS.${targetName}.${moduleKey} || {};`,
        ...exportedNames.map(
          (name) => `RTMX_COMPAT_TARGETS.${targetName}.${moduleKey}.${name} = ${name};`
        ),
      ].join("\n")
    ),
    "})();",
    "",
  ].join("\n");
}

function splitIncludeDirectives(text: string): { includes: string[]; body: string } {
  const includes: string[] = [];
  const body: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("//include <")) {
      includes.push(line);
    } else {
      body.push(line);
    }
  }
  return { includes, body: body.join("\n") };
}

function collectExportedNames(sourceTs: string): string[] {
  const sourceText = fs.readFileSync(sourceTs, "utf-8");
  const sourceFile = ts.createSourceFile(sourceTs, sourceText, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (hasExportModifier(node)) {
      if (
        (ts.isClassDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name
      ) {
        names.push(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names.filter((name, index) => names.indexOf(name) === index);
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
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
