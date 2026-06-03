import * as fs from "fs";
import * as path from "path";
import type { MultiTargetConfig, RtmxConfig } from "./config.js";
import { stripMinecraftAssetPrefix } from "./compile.js";

export interface CopyAssetsResult {
  copied: number;
}

interface AssetRoot {
  sourceRoot: string;
  outputRoot: string;
  stripMinecraftPrefix: boolean;
}

export function copyBuildAssets(config: RtmxConfig): CopyAssetsResult {
  const srcDirs = config.srcDirs?.length ? config.srcDirs : [config.srcDir];
  return copyAssetRoots(
    srcDirs.map((sourceRoot) => ({
      sourceRoot,
      outputRoot: config.outDir,
      stripMinecraftPrefix: false,
    }))
  );
}

export function copyMultiTargetBuildAssets(config: MultiTargetConfig): CopyAssetsResult {
  const roots: AssetRoot[] = [];
  const commonSrcDir = config.commonSrcDir ? path.resolve(config.commonSrcDir) : undefined;

  if (commonSrcDir) {
    roots.push({
      sourceRoot: commonSrcDir,
      outputRoot: config.outDir,
      stripMinecraftPrefix: false,
    });
  }

  for (const target of Object.values(config.targets)) {
    const srcDirs = target.srcDirs?.length ? target.srcDirs : [target.srcDir];
    for (const sourceRoot of srcDirs) {
      if (commonSrcDir && samePath(sourceRoot, commonSrcDir)) continue;
      roots.push({
        sourceRoot,
        outputRoot: target.outDir,
        stripMinecraftPrefix: true,
      });
    }
  }

  return copyAssetRoots(roots);
}

function copyAssetRoots(roots: AssetRoot[]): CopyAssetsResult {
  let copied = 0;

  for (const root of roots) {
    const sourceRoot = path.resolve(root.sourceRoot);
    const outputRoot = path.resolve(root.outputRoot);
    if (!fs.existsSync(sourceRoot)) continue;

    for (const file of collectAssetFiles(sourceRoot, [outputRoot])) {
      const rel = path.relative(sourceRoot, file).replace(/\\/g, "/");
      if (rel.endsWith(".ts")) continue;

      const outputRel = root.stripMinecraftPrefix ? stripMinecraftAssetPrefix(rel) : rel;
      const destination = path.join(outputRoot, outputRel);
      if (samePath(file, destination)) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
      copied++;
    }
  }

  return { copied };
}

function collectAssetFiles(dir: string, ignoredDirs: string[]): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.some((ignoredDir) => samePath(full, ignoredDir))) continue;
      results.push(...collectAssetFiles(full, ignoredDirs));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }

  return results;
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
