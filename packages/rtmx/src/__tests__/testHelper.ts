import ts from "typescript";

/** テスト用のインライン typings (declare module 形式) */
export const FIXTURE_TYPINGS = `
declare const Packages: any;
declare const renderer: any;

declare module "net.minecraft.entity" {
  export class Entity {
    rotationYaw: number;
    posX: number;
    posY: number;
    posZ: number;
    getDistance(x: number, y: number, z: number): number;
    getEntityId(): number;
    setEntityId(id: number): void;
    setDead(): void;
  }

  export class VehicleBase<T = any> extends Entity {
  }

  export class Vehicle extends VehicleBase<string> {
  }
}

declare module "net.minecraft.block" {
  export class Block {
    static getIdFromBlock(block: Block): number;
  }
}

declare module "org.lwjgl.opengl" {
  export class GL11 {
    static GL_LIGHTING: number;
    static glDisable(cap: number): void;
  }
}

declare module "jp.ngt.rtm.render" {
  export class TrainModelRenderer {
    renderTrain(): void;
  }
}
`;

export const FIXTURE_MAPPINGS = {
  classes: {
    "net.minecraft.entity.Entity": {
      srg: "net.minecraft.entity.Entity",
      fields: {
        rotationYaw: { srg: "field_70177_z", desc: "F" },
        posX: { srg: "field_70165_t", desc: "D" },
        posY: { srg: "field_70163_p", desc: "D" },
      },
      methods: {
        "getDistance(DDD)D": { srg: "func_70011_f" },
        "getEntityId()I": { srg: "func_145782_y" },
        "setEntityId(I)V": { srg: "func_145769_d" },
        "setDead()V": { srg: "func_70106_y" },
      },
    },
    "net.minecraft.block.Block": {
      srg: "net.minecraft.block.Block",
      fields: {},
      methods: {
        "getIdFromBlock(Lnet/minecraft/block/Block;)I": { srg: "func_149682_b" },
      },
    },
  },
};

/** 複数の仮想ファイルから TypeScript Program + TypeChecker を生成 */
export function createTestProgram(files: Record<string, string>): {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
} {
  const typingsFileName = "/__typings__.d.ts";

  const allFiles: Record<string, string> = {
    [typingsFileName]: FIXTURE_TYPINGS,
    ...files,
  };

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    skipLibCheck: true,
    noEmitOnError: false,
  };

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (fileName, langVersion) => {
    const text = allFiles[fileName];
    if (text !== undefined) {
      return ts.createSourceFile(fileName, text, langVersion, true);
    }
    return origGetSourceFile(fileName, langVersion);
  };

  host.fileExists = (f) => f in allFiles || ts.sys.fileExists(f);
  host.readFile = (f) => allFiles[f] ?? ts.sys.readFile(f);

  const fileNames = Object.keys(files);
  const program = ts.createProgram([typingsFileName, ...fileNames], compilerOptions, host);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(fileNames[0])!;

  return { program, checker, sourceFile };
}

/** ソースファイルにトランスフォーマーを適用して JS 文字列を返す */
export function transform(
  source: string,
  makeTransformers: (checker: ts.TypeChecker, diagnostics: ts.Diagnostic[]) => ts.CustomTransformers
): { js: string; diagnostics: ts.Diagnostic[] } {
  const { program, checker } = createTestProgram({ "/main.ts": source });

  const diagnostics: ts.Diagnostic[] = [];
  const transformers = makeTransformers(checker, diagnostics);

  let output = "";
  program.emit(
    program.getSourceFile("/main.ts"),
    (_, text) => {
      output = text;
    },
    undefined,
    false,
    transformers
  );

  // CJS boilerplate を除去
  output = stripBoilerplate(output);

  return { js: output, diagnostics };
}

function stripBoilerplate(text: string): string {
  const requireMap = new Map<string, string>();
  text = text.replace(
    /^(?:var|const|let) (\w+) = require\("([^"]+)"\);\r?\n/gm,
    (whole, varName: string, moduleName: string) => {
      if (!moduleName.startsWith(".") && moduleName.includes(".")) {
        requireMap.set(varName, moduleName);
        return "";
      }
      return whole;
    }
  );
  const varDecls: string[] = [];
  for (const [varName, moduleName] of requireMap) {
    const used = new Set<string>();
    const re = new RegExp(`\\b${varName}\\.(\\w+)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) used.add(m[1]);
    for (const cls of used) varDecls.push(`var ${cls} = Packages.${moduleName}.${cls};`);
    text = text.replace(new RegExp(`\\b${varName}\\.(\\w+)`, "g"), (_, c) => c);
  }
  text = text
    .replace(/^"use strict";\r?\n/m, "")
    .replace(/^Object\.defineProperty\(exports,\s*"__esModule",\s*\{[^}]*\}\);\r?\n/m, "")
    .replace(/^exports\.\w+\s*=\s*void 0;\r?\n/gm, "")
    .trimStart();
  if (varDecls.length > 0) text = varDecls.join("\n") + "\n" + text;
  return text;
}
