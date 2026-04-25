#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import { loadConfig } from "./config.js";
import { compile } from "./compile.js";
import { generate } from "./generate.js";
import { init } from "./init.js";
import { zip } from "./zip.js";

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
    const ok = compile(config);
    process.exit(ok ? 0 : 1);
  });

program
  .command("zip")
  .description("Create artifacts/<name>.zip containing src/ and dist/ (excluding .ts files)")
  .option("-c, --config <path>", "Path to rtmx.json", "rtmx.json")
  .action((opts: { config: string }) => {
    const configPath = path.resolve(process.cwd(), opts.config);
    const config = loadConfig(configPath);
    zip(config, path.dirname(configPath));
  });

program.parse(process.argv);
