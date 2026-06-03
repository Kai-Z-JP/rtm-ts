#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import { isMultiTargetConfig, loadConfig, MultiTargetConfig, RtmxConfig } from "./config.js";
import { compile } from "./compile.js";
import { generate } from "./generate.js";
import { init } from "./init.js";
import { generateDispatchers } from "./multiTarget.js";
import { zip, zipMultiTarget } from "./zip.js";
import { generateCommonApiMetadata } from "./commonApi.js";
import { copyBuildAssets, copyMultiTargetBuildAssets } from "./assets.js";

const program = new Command("rtmx");

program
  .command("init [dir]")
  .description("Scaffold a new RTM scripting project")
  .action((dir: string = ".") => {
    init(dir);
  });

program
  .command("generate")
  .description("Generate d.ts typings and mcp-to-srg.json from Minecraft JARs")
  .option("-c, --config <path>", "Path to rtmx.json", "rtmx.json")
  .action((opts: { config: string }) => {
    const configPath = path.resolve(process.cwd(), opts.config);
    const config = loadConfig(configPath);
    if (isMultiTargetConfig(config)) {
      for (const target of Object.values(config.targets)) {
        if (!target.scan) {
          console.error(`No 'scan' config found for target '${target.targetName}'`);
          process.exit(1);
        }
        console.log(`[rtmx] Generating target: ${target.targetName}`);
        generate(target.scan);
      }
      generateCommonApiMetadata(config);
      return;
    }
    if (!config.scan) {
      console.error("No 'scan' config found in rtmx.json");
      process.exit(1);
    }
    generate(config.scan);
  });

program
  .command("build")
  .description("Compile TypeScript scripts")
  .option("-c, --config <path>", "Path to rtmx.json", "rtmx.json")
  .action((opts: { config: string }) => {
    const configPath = path.resolve(process.cwd(), opts.config);
    const config = loadConfig(configPath);
    if (isMultiTargetConfig(config)) {
      let ok = true;
      const commonConfig = createCommonBuildConfig(config);
      if (commonConfig) {
        console.log("[rtmx] Building common");
        ok = compile(commonConfig) && ok;
      }
      for (const target of Object.values(config.targets)) {
        console.log(`[rtmx] Building target: ${target.targetName}`);
        ok = compile(target) && ok;
      }
      if (ok) {
        generateDispatchers(config);
        logCopiedAssets(copyMultiTargetBuildAssets(config).copied);
      }
      process.exit(ok ? 0 : 1);
    }
    const ok = compile(config);
    if (ok) logCopiedAssets(copyBuildAssets(config).copied);
    process.exit(ok ? 0 : 1);
  });

program
  .command("zip")
  .description("Create artifacts/<name>.zip containing src/ and dist/ (excluding .ts files)")
  .option("-c, --config <path>", "Path to rtmx.json", "rtmx.json")
  .action((opts: { config: string }) => {
    const configPath = path.resolve(process.cwd(), opts.config);
    const config = loadConfig(configPath);
    if (isMultiTargetConfig(config)) {
      zipMultiTarget(config, path.dirname(configPath));
      return;
    }
    zip(config, path.dirname(configPath));
  });

program.parse(process.argv);

function createCommonBuildConfig(config: MultiTargetConfig): RtmxConfig | undefined {
  if (!config.commonSrcDir) return undefined;
  const firstTarget = Object.values(config.targets)[0];
  if (!firstTarget) return undefined;
  return {
    name: config.name,
    srcDir: config.commonSrcDir,
    srcDirs: [config.commonSrcDir],
    outDir: config.outDir,
    typings: [`${config.commonApiTypingsDir}/*.d.ts`],
    mapping: firstTarget.mapping,
    compilerOptions: firstTarget.compilerOptions,
    targetAliasDirs: [config.commonSrcDir],
    commonOutDir: config.outDir,
    commonSrcDir: config.commonSrcDir,
    commonApiManifest: config.commonApiManifest,
    commonApiTypingsDir: config.commonApiTypingsDir,
    commonApiPolicy: config.commonApiPolicy,
  };
}

function logCopiedAssets(copied: number): void {
  if (copied > 0) console.log(`[rtmx] Copied ${copied} asset files`);
}
