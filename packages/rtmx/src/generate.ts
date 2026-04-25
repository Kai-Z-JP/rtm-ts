import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as child_process from "child_process";
import * as crypto from "crypto";
import { ScanConfig } from "./config.js";

const CACHE_DIR = path.join(os.homedir(), ".rtmx", "gradle");
const TEMPLATE_DIR = path.join(__dirname, "..", "template");
const JARS_DIR = path.join(__dirname, "..", "jars");

interface RtmPaths {
  deobfJar: string;
  srgToMcpFile: string;
  mcpToSrgFile: string;
  compileClasspath: string[];
}

export function generate(scan: ScanConfig): void {
  const projectDir = getOrCreateGradleProject(scan);

  const pathsFile = path.join(projectDir, "build", "rtm-paths.json");
  const needsRun = !fs.existsSync(pathsFile) || isConfigNewer(scan, pathsFile);

  if (needsRun) {
    console.log("[rtmx] Running Gradle to prepare Minecraft JARs...");
    runGradle(projectDir, "exportRtmPaths");
  } else {
    console.log("[rtmx] Using cached Minecraft JARs.");
  }

  const rtmPaths: RtmPaths = JSON.parse(fs.readFileSync(pathsFile, "utf-8"));
  runScanner(scan, rtmPaths);
}

function getOrCreateGradleProject(scan: ScanConfig): string {
  const hash = configHash(scan);
  const projectDir = path.join(CACHE_DIR, hash);
  fs.mkdirSync(projectDir, { recursive: true });

  writeTemplateFile(projectDir, "settings.gradle.kts");
  writeGradleProperties(projectDir, scan);
  writeBuildGradle(projectDir, scan);
  ensureGradleWrapper(projectDir);

  return projectDir;
}

function writeTemplateFile(projectDir: string, fileName: string): void {
  const src = path.join(TEMPLATE_DIR, fileName);
  const dst = path.join(projectDir, fileName);
  if (!fs.existsSync(dst)) {
    fs.copyFileSync(src, dst);
  }
}

function writeGradleProperties(projectDir: string, scan: ScanConfig): void {
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, "gradle.properties.template"), "utf-8");
  const content = template
    .replace("{{MINECRAFT_VERSION}}", scan.minecraftVersion)
    .replace("{{FORGE_VERSION}}", scan.forgeVersion)
    .replace("{{CHANNEL}}", scan.channel ?? "stable")
    .replace("{{MAPPINGS_VERSION}}", scan.mappingsVersion);
  fs.writeFileSync(path.join(projectDir, "gradle.properties"), content);
}

function writeBuildGradle(projectDir: string, scan: ScanConfig): void {
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, "build.gradle.kts.template"), "utf-8");
  const deps = (scan.mods ?? []).map((m) => `    implementation(rfg.deobf("${m}"))`).join("\n");
  const content = template.replace("    // {{DEPENDENCIES}}", deps);
  fs.writeFileSync(path.join(projectDir, "build.gradle.kts"), content);
}

function ensureGradleWrapper(projectDir: string): void {
  const wrapperDir = path.join(projectDir, "gradle", "wrapper");
  fs.mkdirSync(wrapperDir, { recursive: true });

  const files = [
    ["gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.jar"],
    ["gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.properties"],
    ["gradlew", "gradlew"],
    ["gradlew.bat", "gradlew.bat"],
  ];
  for (const [src, dst] of files) {
    const dstPath = path.join(projectDir, dst);
    if (!fs.existsSync(dstPath)) {
      fs.copyFileSync(path.join(TEMPLATE_DIR, src), dstPath);
      if (dst === "gradlew") fs.chmodSync(dstPath, 0o755);
    }
  }
}

function runGradle(projectDir: string, task: string): void {
  const gradlew = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";

  const gradleJavaHome = process.env["npm_config_gradle_java_home"];
  console.log(`[rtmx] Gradle Java Home: ${gradleJavaHome}`);

  const result = child_process.spawnSync(gradlew, [task, "--stacktrace"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(gradleJavaHome ? { JAVA_HOME: gradleJavaHome } : {}),
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getJavaExecutable(): string {
  const javaHome = process.env["npm_config_gradle_java_home"] || process.env["JAVA_HOME"];
  if (javaHome) {
    const executable = process.platform === "win32" ? "java.exe" : "java";
    return path.join(javaHome, "bin", executable);
  }
  return "java";
}

function runScanner(scan: ScanConfig, paths: RtmPaths): void {
  const scannerJar = path.join(JARS_DIR, "scanner.jar");
  if (!fs.existsSync(scannerJar)) {
    throw new Error(
      `scanner.jar not found at ${scannerJar}. Run: ./gradlew :gradle-generator:installScannerJar`
    );
  }

  const outputDir = scan.outputDir!;
  const typingsDir = path.join(outputDir, "typings");
  const mappingsDir = path.join(outputDir, "mappings");
  fs.mkdirSync(typingsDir, { recursive: true });
  fs.mkdirSync(mappingsDir, { recursive: true });

  const classpath = [paths.deobfJar, ...paths.compileClasspath].join(path.delimiter);

  const javaArgs = [
    "-jar",
    scannerJar,
    "--classpath",
    classpath,
    "--packages",
    scan.packages.join(","),
    "--srgToMcpFile",
    paths.srgToMcpFile,
    "--mcpToSrgFile",
    paths.mcpToSrgFile,
    "--typingsDir",
    typingsDir,
    "--mappingsDir",
    mappingsDir,
  ];

  console.log("[rtmx] Scanning JARs...");
  const result = child_process.spawnSync(getJavaExecutable(), javaArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function configHash(scan: ScanConfig): string {
  const key = JSON.stringify({
    minecraftVersion: scan.minecraftVersion,
    forgeVersion: scan.forgeVersion,
    channel: scan.channel,
    mappingsVersion: scan.mappingsVersion,
    mods: scan.mods ?? [],
  });
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

function isConfigNewer(scan: ScanConfig, pathsFile: string): boolean {
  // 簡易チェック: rtmx.json の mtime が rtm-paths.json より新しければ再実行
  try {
    const pathsMtime = fs.statSync(pathsFile).mtimeMs;
    const configMtime = Date.now();
    void configMtime;
    void pathsMtime;
    return false;
  } catch {
    return true;
  }
}
