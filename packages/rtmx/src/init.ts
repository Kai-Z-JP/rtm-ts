import * as fs from "fs";
import * as path from "path";

function makeRtmxJson(name: string): string {
  return JSON.stringify(
    {
      name,
      srcDir: "src",
      outDir: "dist",
      scan: {
        minecraftVersion: "1.7.10",
        forgeVersion: "10.13.4.1614",
        channel: "stable",
        mappingsVersion: "12",
        mods: ["com.github.Kai-Z-JP:KaizPatchX:v1.9.5"],
        packages: ["net.minecraft", "net.minecraftforge", "cpw.mods", "jp.ngt", "org.lwjgl"],
      },
      compilerOptions: {
        strict: true,
        target: "ES5",
        module: "none",
        noEmitOnError: true,
        skipLibCheck: true,
      },
    },
    null,
    2
  );
}

const TSCONFIG_JSON = JSON.stringify(
  {
    compilerOptions: {
      target: "ES5",
      lib: ["ES5"],
      module: "commonjs",
      moduleResolution: "node",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["src/**/*.ts", "generated/typings/**/*.d.ts"],
  },
  null,
  2
);

const GITIGNORE = `node_modules/
dist/
generated/
artifacts/
`;

function writeIfAbsent(filePath: string, content: string) {
  if (fs.existsSync(filePath)) {
    console.log(`  skip  ${path.basename(filePath)} (already exists)`);
    return;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  write ${path.basename(filePath)}`);
}

function mkdirLog(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  console.log(`  mkdir ${dir}`);
}

export function init(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });

  mkdirLog(path.join(targetDir, "src/assets/minecraft/scripts"));
  mkdirLog(path.join(targetDir, "src/assets/minecraft/models"));
  mkdirLog(path.join(targetDir, "src/assets/minecraft/textures"));
  mkdirLog(path.join(targetDir, "src/mods"));

  const name = path.basename(path.resolve(targetDir));

  const packageJson = JSON.stringify(
    {
      name,
      version: "1.0.0",
      private: true,
      scripts: {
        pregen: "node -e \"require('fs').rmSync('generated',{recursive:true,force:true})\"",
        gen: "rtmx generate",
        prebuild: "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"",
        build: "rtmx build",
        prezip: "pnpm run build",
        zip: "rtmx zip",
        clean:
          "node -e \"['dist','generated','artifacts'].forEach(d=>require('fs').rmSync(d,{recursive:true,force:true}))\"",
      },
      dependencies: {
        "rtm-ts": "latest",
      },
    },
    null,
    2
  );

  writeIfAbsent(path.join(targetDir, "rtmx.json"), makeRtmxJson(name));
  writeIfAbsent(path.join(targetDir, "package.json"), packageJson);
  writeIfAbsent(path.join(targetDir, "tsconfig.json"), TSCONFIG_JSON);
  writeIfAbsent(path.join(targetDir, ".gitignore"), GITIGNORE);

  console.log(`\nDone! Next steps:`);
  console.log(`  cd ${targetDir}`);
  console.log(`  pnpm install`);
  console.log(`  # Edit rtmx.json (set mods, packages, versions)`);
  console.log(`  pnpm gen`);
  console.log(`  pnpm build`);
}
