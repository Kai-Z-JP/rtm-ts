import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

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
  outDir: string;
  typings: string[];
  mapping: string;
  compilerOptions?: ts.CompilerOptions;
  /** 省略時はスキャンをスキップして既存の generated/ を使う */
  scan?: ScanConfig;
}

export function loadConfig(configPath: string): RtmxConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  const json = JSON.parse(raw) as Omit<RtmxConfig, "compilerOptions"> & {
    compilerOptions?: Record<string, unknown>;
  };

  const dir = path.dirname(configPath);
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(dir, p));

  // scan.outputDir のデフォルトは config ファイルと同階層の generated/
  const scanOutputDir = json.scan?.outputDir
    ? resolve(json.scan.outputDir)
    : path.resolve(dir, "generated");

  // typings / mapping が省略されていれば scan.outputDir から推定
  const typings = json.typings ? json.typings.map(resolve) : [`${scanOutputDir}/typings/*.d.ts`];
  const mapping = json.mapping
    ? resolve(json.mapping)
    : `${scanOutputDir}/mappings/mcp-to-srg.json`;

  return {
    name: json.name,
    srcDir: resolve(json.srcDir),
    outDir: resolve(json.outDir),
    typings,
    mapping,
    compilerOptions: json.compilerOptions
      ? ts.convertCompilerOptionsFromJson(json.compilerOptions, dir).options
      : {},
    scan: json.scan ? { channel: "stable", ...json.scan, outputDir: scanOutputDir } : undefined,
  };
}
