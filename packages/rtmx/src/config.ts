import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

export type CommonApiPolicy = "allow" | "error";

export interface ScanConfig {
  /** Minecraft バージョン (例: "1.7.10") */
  minecraftVersion: string;
  /** Forge バージョン (例: "10.13.4.1614") */
  forgeVersion: string;
  /** MCP チャンネル (stable/snapshot) */
  channel?: string;
  /** MCP mappings バージョン */
  mappingsVersion: string;
  /** rfg.deobf() で追加する Maven 座標 */
  mods?: string[];
  /** スキャン対象 Java パッケージプレフィックス */
  packages: string[];
  /** 生成ファイルの出力先 (typings/, mappings/ が作られる) */
  outputDir?: string;
}

export interface RtmxConfig {
  name: string;
  srcDir: string;
  srcDirs?: string[];
  outDir: string;
  typings: string[];
  mapping: string;
  compilerOptions?: ts.CompilerOptions;
  /** 省略時はスキャンをスキップして既存の generated/ を使う */
  scan?: ScanConfig;
  targetName?: string;
  targetAliasDirs?: string[];
  commonOutDir?: string;
  lazyJavaImports?: boolean;
  wrapEntries?: string[];
  commonSrcDir?: string;
  commonApiManifest?: string;
  commonApiTypingsDir?: string;
  commonApiPolicy?: CommonApiPolicy;
  compatFallbackTarget?: string;
}

export interface RuntimeDispatchRule {
  target: string;
  condition: string;
}

export interface MultiTargetConfig {
  name: string;
  entries: string[];
  runtimeDispatch: RuntimeDispatchRule[];
  targets: Record<string, RtmxConfig>;
  outDir: string;
  commonSrcDir?: string;
  commonApiManifest: string;
  commonApiTypingsDir: string;
  commonApiPolicy: CommonApiPolicy;
}

export type LoadedConfig = RtmxConfig | MultiTargetConfig;

export function isMultiTargetConfig(config: LoadedConfig): config is MultiTargetConfig {
  return "targets" in config;
}

export function loadConfig(configPath: string): LoadedConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as Omit<RtmxConfig, "compilerOptions"> & {
    compilerOptions?: Record<string, unknown>;
    targets?: Record<
      string,
      Partial<Omit<RtmxConfig, "compilerOptions">> & {
        compilerOptions?: Record<string, unknown>;
        runtimeDispatch?: string;
      }
    >;
  };

  const dir = path.dirname(configPath);
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(dir, p));

  if (json.targets) {
    const targets: Record<string, RtmxConfig> = {};
    const inferredEntries = inferEntryFiles(json.targets, dir);
    const commonSrcDir = json.commonSrcDir
      ? resolve(json.commonSrcDir)
      : inferCommonSrcDir(json.targets, dir);
    const commonApiManifest = resolve(json.commonApiManifest ?? "generated/common-api.json");
    const commonApiTypingsDir = resolve(json.commonApiTypingsDir ?? "generated/common/typings");
    const commonApiPolicy = parseCommonApiPolicy(json.commonApiPolicy);
    for (const [targetName, targetJson] of Object.entries(json.targets)) {
      if (!/^[A-Za-z0-9_-]+$/.test(targetName)) {
        throw new Error(`Invalid target name "${targetName}" (use only A-Z, a-z, 0-9, _, -)`);
      }
      targets[targetName] = loadSingleConfig(
        {
          name: json.name,
          ...targetJson,
          targetName,
          lazyJavaImports: true,
          wrapEntries: inferredEntries,
          commonSrcDir,
          commonOutDir: json.outDir ? resolve(json.outDir) : resolve("dist"),
          commonApiManifest,
          commonApiPolicy,
        },
        dir,
        `generated/${targetName}`
      );
    }
    validateCompatFallbackTargets(targets);

    return {
      name: json.name,
      entries: inferredEntries,
      runtimeDispatch: getRuntimeDispatchRules(json.targets),
      targets,
      outDir: json.outDir ? resolve(json.outDir) : resolve("dist"),
      commonSrcDir,
      commonApiManifest,
      commonApiTypingsDir,
      commonApiPolicy,
    };
  }

  return loadSingleConfig(json, dir, "generated");
}

function loadSingleConfig(
  json: Partial<Omit<RtmxConfig, "compilerOptions">> & {
    name?: string;
    compilerOptions?: Record<string, unknown>;
  },
  dir: string,
  defaultScanOutputDir: string
): RtmxConfig {
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(dir, p));

  // scan.outputDir のデフォルトは config ファイルと同階層の generated/
  const scanOutputDir = json.scan?.outputDir
    ? resolve(json.scan.outputDir)
    : resolve(defaultScanOutputDir);

  // typings / mapping が省略されていれば scan.outputDir から推定
  const typings = json.typings ? json.typings.map(resolve) : [`${scanOutputDir}/typings/*.d.ts`];
  const mapping = json.mapping
    ? resolve(json.mapping)
    : `${scanOutputDir}/mappings/mcp-to-srg.json`;

  return {
    name: json.name ?? "rtmx",
    srcDir: resolve(json.srcDir ?? json.srcDirs?.[0] ?? "src"),
    srcDirs: json.srcDirs?.map(resolve),
    outDir: resolve(json.outDir ?? "dist"),
    typings,
    mapping,
    compilerOptions: json.compilerOptions
      ? ts.convertCompilerOptionsFromJson(json.compilerOptions, dir).options
      : {},
    scan: json.scan ? { channel: "stable", ...json.scan, outputDir: scanOutputDir } : undefined,
    targetName: json.targetName,
    targetAliasDirs: json.srcDirs?.map(resolve),
    commonOutDir: json.commonOutDir ? resolve(json.commonOutDir) : undefined,
    lazyJavaImports: json.lazyJavaImports,
    wrapEntries: json.wrapEntries,
    commonSrcDir: json.commonSrcDir ? resolve(json.commonSrcDir) : undefined,
    commonApiManifest: json.commonApiManifest ? resolve(json.commonApiManifest) : undefined,
    commonApiTypingsDir: json.commonApiTypingsDir ? resolve(json.commonApiTypingsDir) : undefined,
    commonApiPolicy: json.commonApiPolicy,
    compatFallbackTarget: json.compatFallbackTarget,
  };
}

function validateCompatFallbackTargets(targets: Record<string, RtmxConfig>): void {
  for (const [targetName, target] of Object.entries(targets)) {
    const fallbackTarget = target.compatFallbackTarget;
    if (!fallbackTarget) continue;
    if (fallbackTarget === targetName) {
      throw new Error(`Target "${targetName}" cannot use itself as compatFallbackTarget`);
    }
    if (!targets[fallbackTarget]) {
      throw new Error(
        `Target "${targetName}" references unknown compatFallbackTarget "${fallbackTarget}"`
      );
    }
  }

  for (const targetName of Object.keys(targets)) {
    const seen = new Set<string>();
    let current: string | undefined = targetName;
    while (current) {
      if (seen.has(current)) {
        throw new Error(`compatFallbackTarget cycle detected at target "${current}"`);
      }
      seen.add(current);
      current = targets[current]?.compatFallbackTarget;
    }
  }
}

function inferCommonSrcDir(
  targets: Record<string, Partial<Omit<RtmxConfig, "compilerOptions">>>,
  configDir: string
): string | undefined {
  const firstRoots = Object.values(targets)
    .map((target) => target.srcDirs?.[0] ?? target.srcDir)
    .filter((root): root is string => !!root)
    .map((root) => (path.isAbsolute(root) ? root : path.resolve(configDir, root)));
  if (firstRoots.length === 0) return undefined;
  const first = path.resolve(firstRoots[0]);
  return firstRoots.every((root) => path.resolve(root) === first) ? first : undefined;
}

function parseCommonApiPolicy(policy: CommonApiPolicy | undefined): CommonApiPolicy {
  if (!policy) return "allow";
  if (policy === "allow" || policy === "error") return policy;
  throw new Error(`Invalid commonApiPolicy "${policy}" (use "allow" or "error")`);
}

function inferEntryFiles(
  targets: NonNullable<
    (Omit<RtmxConfig, "compilerOptions"> & {
      targets?: Record<
        string,
        Partial<Omit<RtmxConfig, "compilerOptions">> & { runtimeDispatch?: string }
      >;
    })["targets"]
  >,
  configDir: string
): string[] {
  const entries = new Set<string>();
  for (const target of Object.values(targets)) {
    const srcDirs = target.srcDirs ?? (target.srcDir ? [target.srcDir] : []);
    const srcDir = srcDirs[0];
    if (!srcDir) continue;
    const absSrcDir = path.isAbsolute(srcDir) ? srcDir : path.resolve(configDir, srcDir);
    if (!fs.existsSync(absSrcDir)) continue;
    for (const file of collectEntryFiles(absSrcDir)) {
      entries.add(path.relative(absSrcDir, file).replace(/\\/g, "/"));
    }
  }
  return [...entries].sort();
}

function getRuntimeDispatchRules(
  targets: Record<string, { runtimeDispatch?: string }>
): RuntimeDispatchRule[] {
  return Object.entries(targets)
    .filter(([, target]) => target.runtimeDispatch)
    .map(([target, config]) => ({
      target,
      condition: config.runtimeDispatch!,
    }));
}

function collectEntryFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "lib") continue;
      results.push(...collectEntryFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".compat.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}
