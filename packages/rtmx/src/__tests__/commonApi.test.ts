import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { generateCommonApiMetadata, type CommonApiManifest } from "../commonApi.js";
import { compile } from "../compile.js";
import type { MultiTargetConfig, RtmxConfig } from "../config.js";

describe("common API", () => {
  it("target 固有 API に @deprecated を付けて manifest を生成する", () => {
    const fixture = createFixture();
    try {
      generateCommonApiMetadata(fixture.config);
      generateCommonApiMetadata(fixture.config);

      const mc1710Typing = readFileSync(fixture.mc1710Typing, "utf-8");
      const mc1122Typing = readFileSync(fixture.mc1122Typing, "utf-8");
      const commonTyping = readFileSync(fixture.commonTyping, "utf-8");
      const manifest = JSON.parse(
        readFileSync(fixture.config.commonApiManifest, "utf-8")
      ) as CommonApiManifest;

      expect(mc1710Typing).not.toContain("@deprecated");
      expect(mc1122Typing).not.toContain("@deprecated");
      expect(commonTyping).toContain(`        /**
         * @deprecated target-specific API. Available targets: mc1710
         * @rtmx-target-specific mc1710
         */
        oldApi(): number;`);
      expect(commonTyping).toContain(`        /**
         * @deprecated target-dependent SRG mapping.
         * @rtmx-target-specific mc1122, mc1710
         */
        commonApi(): number;`);
      expect(commonTyping).not.toContain(
        "@deprecated target-specific API. Available targets: mc1710, mc1122"
      );
      expect(commonTyping.match(/@rtmx-target-specific mc1710/g)).toHaveLength(1);
      expect(commonTyping).toContain(`    /**
     * @deprecated target-specific API. Available targets: mc1122
     * @rtmx-target-specific mc1122
     */
    export abstract class ModernOnly`);
      expect(existsSync(path.join(fixture.config.commonApiTypingsDir, "mc1710"))).toBe(false);
      expect(existsSync(path.join(fixture.config.commonApiTypingsDir, "mc1122"))).toBe(false);
      expect(Object.values(manifest.members).some((entry) => entry.label.endsWith("#oldApi"))).toBe(
        true
      );
      expect(
        Object.values(manifest.members).find((entry) => entry.label.endsWith("#commonApi"))?.reason
      ).toBe("mapping");
      expect(
        Object.values(manifest.members).find((entry) => entry.label.endsWith("#oldApi"))?.reason
      ).toBe("availability");
      expect(manifest.classes["class:net.minecraft.entity.ModernOnly"]?.targets).toEqual([
        "mc1122",
      ]);
    } finally {
      fixture.dispose();
    }
  });

  it.each([
    ["allow", true, "warning"],
    ["error", false, "error"],
  ] as const)("commonApiPolicy=%s で RTM005 を %s にする", (policy, succeeds, level) => {
    const fixture = createFixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      generateCommonApiMetadata(fixture.config);
      const compileConfig = createCommonCompileConfig(fixture.config, policy);

      expect(compile(compileConfig)).toBe(succeeds);
      expect(consoleError.mock.calls.flat().join("\n")).toContain(`${level}: RTM005`);
    } finally {
      consoleError.mockRestore();
      fixture.dispose();
    }
  });

  it("target build では common API 診断を出さない", () => {
    const fixture = createFixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      generateCommonApiMetadata(fixture.config);

      expect(compile(fixture.config.targets.mc1710)).toBe(true);
      expect(consoleError.mock.calls.flat().join("\n")).not.toContain("RTM005");
    } finally {
      consoleError.mockRestore();
      fixture.dispose();
    }
  });

  it("SRG 名が target ごとに異なる API を common から使うと RTM005 にする", () => {
    const fixture = createFixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      writeFileSync(
        fixture.commonSource,
        `import { Entity } from "net.minecraft.entity";
function render(entity: Entity): number {
  return entity.commonApi();
}
`,
        "utf-8"
      );
      generateCommonApiMetadata(fixture.config);

      expect(compile(createCommonCompileConfig(fixture.config))).toBe(true);
      expect(consoleError.mock.calls.flat().join("\n")).toContain(
        'warning: RTM005: API "net.minecraft.entity.Entity#commonApi" has target-dependent SRG mappings'
      );
    } finally {
      consoleError.mockRestore();
      fixture.dispose();
    }
  });

  it("型引数だけが違う member は同じ common API として扱う", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        fixture.mc1710Typing,
        `declare namespace jp.ngt.rtm.modelpack.state {
  class ResourceState<T = any> {
    getDataMap(): number;
  }
}
declare namespace jp.ngt.rtm.entity.vehicle {
  abstract class EntityVehicleBase<T = any> {
    getResourceState(): jp.ngt.rtm.modelpack.state.ResourceState;
  }
  abstract class EntityVehicle extends jp.ngt.rtm.entity.vehicle.EntityVehicleBase {
    abstract getResourceState(): jp.ngt.rtm.modelpack.state.ResourceState;
  }
}
`,
        "utf-8"
      );
      writeFileSync(
        fixture.mc1122Typing,
        `declare namespace jp.ngt.rtm.modelpack.state {
  class ResourceState<T = any> {
    getDataMap(): number;
  }
}
declare namespace jp.ngt.rtm.entity.vehicle {
  abstract class EntityVehicleBase<T = any> {
    getResourceState(): jp.ngt.rtm.modelpack.state.ResourceState<T>;
  }
  abstract class EntityVehicle extends jp.ngt.rtm.entity.vehicle.EntityVehicleBase {
  }
}
`,
        "utf-8"
      );

      generateCommonApiMetadata(fixture.config);
      const manifest = JSON.parse(
        readFileSync(fixture.config.commonApiManifest, "utf-8")
      ) as CommonApiManifest;

      expect(
        Object.values(manifest.members).some((entry) => entry.label.endsWith("#getResourceState"))
      ).toBe(false);
    } finally {
      fixture.dispose();
    }
  });
});

function createFixture(): {
  config: MultiTargetConfig;
  commonSource: string;
  mc1710Typing: string;
  mc1122Typing: string;
  commonTyping: string;
  dispose(): void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "rtmx-common-api-"));
  const commonDir = path.join(root, "src/common");
  const mc1710Dir = path.join(root, "src/mc1710");
  const mc1122Dir = path.join(root, "src/mc1122");
  const mc1710TypingsDir = path.join(root, "generated/mc1710/typings");
  const mc1122TypingsDir = path.join(root, "generated/mc1122/typings");
  const mc1710Typing = path.join(mc1710TypingsDir, "net_minecraft_entity.d.ts");
  const mc1122Typing = path.join(mc1122TypingsDir, "net_minecraft_entity.d.ts");
  const mc1710Mapping = path.join(root, "mc1710-mcp-to-srg.json");
  const mc1122Mapping = path.join(root, "mc1122-mcp-to-srg.json");
  const commonSource = path.join(commonDir, "main.ts");

  mkdirSync(commonDir, { recursive: true });
  mkdirSync(mc1710Dir, { recursive: true });
  mkdirSync(mc1122Dir, { recursive: true });
  mkdirSync(mc1710TypingsDir, { recursive: true });
  mkdirSync(mc1122TypingsDir, { recursive: true });
  writeFileSync(mc1710Mapping, JSON.stringify(makeMapping("func_1710", "old_1710")), "utf-8");
  writeFileSync(mc1122Mapping, JSON.stringify(makeMapping("func_1122", "old_1122")), "utf-8");
  writeFileSync(
    commonSource,
    `import { Entity } from "net.minecraft.entity";
function render(entity: Entity): number {
  return entity.oldApi();
}
`,
    "utf-8"
  );
  writeFileSync(
    mc1710Typing,
    `declare module "net.minecraft.entity" {
  export class Entity {
    commonApi(): number;
    oldApi(): number;
  }
}
`,
    "utf-8"
  );
  writeFileSync(
    mc1122Typing,
    `declare module "net.minecraft.entity" {
  export class Entity {
    commonApi(): number;
    modernApi(): number;
  }
  export abstract class ModernOnly {
    modernApi(): number;
  }
}
`,
    "utf-8"
  );

  const commonApiManifest = path.join(root, "generated/common-api.json");
  const commonApiTypingsDir = path.join(root, "generated/common/typings");
  const makeTarget = (
    name: string,
    targetDir: string,
    typingsDir: string,
    mapping: string
  ): RtmxConfig => ({
    name: "test",
    srcDir: commonDir,
    srcDirs: [commonDir, targetDir],
    outDir: path.join(root, `dist/__targets__/${name}`),
    typings: [path.join(typingsDir, "*.d.ts")],
    mapping,
    targetName: name,
    commonSrcDir: commonDir,
    commonApiManifest,
    commonApiPolicy: "allow",
  });
  const config: MultiTargetConfig = {
    name: "test",
    entries: [],
    runtimeDispatch: [],
    targets: {
      mc1710: makeTarget("mc1710", mc1710Dir, mc1710TypingsDir, mc1710Mapping),
      mc1122: makeTarget("mc1122", mc1122Dir, mc1122TypingsDir, mc1122Mapping),
    },
    outDir: path.join(root, "dist"),
    commonSrcDir: commonDir,
    commonApiManifest,
    commonApiTypingsDir,
    commonApiPolicy: "allow",
  };

  return {
    config,
    commonSource,
    mc1710Typing,
    mc1122Typing,
    commonTyping: path.join(commonApiTypingsDir, path.basename(mc1710Typing)),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createCommonCompileConfig(
  config: MultiTargetConfig,
  commonApiPolicy: RtmxConfig["commonApiPolicy"] = config.commonApiPolicy
): RtmxConfig {
  const firstTarget = Object.values(config.targets)[0];
  if (!config.commonSrcDir || !firstTarget) {
    throw new Error("Fixture must define common source and at least one target");
  }

  return {
    name: config.name,
    srcDir: config.commonSrcDir,
    srcDirs: [config.commonSrcDir],
    outDir: config.outDir,
    typings: [path.join(config.commonApiTypingsDir, "*.d.ts")],
    mapping: firstTarget.mapping,
    compilerOptions: firstTarget.compilerOptions,
    targetAliasDirs: [config.commonSrcDir],
    commonOutDir: config.outDir,
    commonSrcDir: config.commonSrcDir,
    commonApiManifest: config.commonApiManifest,
    commonApiTypingsDir: config.commonApiTypingsDir,
    commonApiPolicy,
  };
}

function makeMapping(commonApiSrg: string, oldApiSrg: string) {
  return {
    classes: {
      "net.minecraft.entity.Entity": {
        srg: "net.minecraft.entity.Entity",
        fields: {},
        methods: {
          "commonApi()I": { srg: commonApiSrg },
          "oldApi()I": { srg: oldApiSrg },
        },
      },
    },
  };
}
