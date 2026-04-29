import { describe, it, expect } from "vitest";
import ts from "typescript";
import { createMcpToSrgTransformer } from "../transformers/mcpToSrg.js";
import { createJavaImportTransformer } from "../transformers/javaImportToPackages.js";
import { FIXTURE_MAPPINGS } from "./testHelper.js";
import { transform } from "./testHelper.js";

const makeTransformers = (checker: ts.TypeChecker, diags: ts.Diagnostic[]) => ({
  before: [
    createJavaImportTransformer(checker, diags),
    createMcpToSrgTransformer(checker, FIXTURE_MAPPINGS, diags),
  ],
});

describe("mcpToSrg", () => {
  it("Entity.posX が field_70165_t に変換される", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;
const x = e.posX;`,
      makeTransformers
    );
    expect(js).toContain("e.field_70165_t");
    expect(js).not.toContain("e.posX");
  });

  it("Entity.getDistance が func_70011_f に変換される", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;
const d = e.getDistance(0, 64, 0);`,
      makeTransformers
    );
    expect(js).toContain("e.func_70011_f(0, 64, 0)");
    expect(js).not.toContain("e.getDistance");
  });

  it("number 型では戻り値の int/double を区別できない method も引数一致で変換される", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;
const id = e.getEntityId();`,
      makeTransformers
    );
    expect(js).toContain("e.func_145782_y()");
    expect(js).not.toContain("e.getEntityId");
  });

  it("number 型では引数の int/double を区別できない method も一意なら変換される", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;
e.setEntityId(123);`,
      makeTransformers
    );
    expect(js).toContain("e.func_145769_d(123)");
    expect(js).not.toContain("e.setEntityId");
  });

  it("generic base class を挟んだ継承元の method/field も変換される", () => {
    const { js } = transform(
      `import { Vehicle } from "net.minecraft.entity";
const entity: Vehicle = renderer as any;
entity.setDead();
entity.rotationYaw = 0;`,
      makeTransformers
    );
    expect(js).toContain("entity.func_70106_y()");
    expect(js).toContain("entity.field_70177_z = 0");
    expect(js).not.toContain("entity.setDead");
    expect(js).not.toContain("entity.rotationYaw");
  });

  it("GL11 static method は SRG 変換せず Packages import のみ", () => {
    const { js } = transform(
      `import { GL11 } from "org.lwjgl.opengl";
GL11.glDisable(GL11.GL_LIGHTING);`,
      makeTransformers
    );
    expect(js).toContain("var GL11 = Packages.org.lwjgl.opengl.GL11;");
    // GL11 自体は mapping にないので変換しない
    expect(js).toContain("GL11.glDisable");
    expect(js).toContain("GL11.GL_LIGHTING");
  });

  it("any 型のオブジェクトは SRG 変換しない (RTM002)", () => {
    const { js, diagnostics } = transform(
      `const e: any = renderer;
e.posX;`,
      makeTransformers
    );
    expect(js).toContain("e.posX");
    expect(js).not.toContain("field_70165_t");
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM002"))).toBe(true);
  });

  it("mapping がない field は変換せず RTM003 を出す", () => {
    const { js, diagnostics } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;
e.posZ;`,
      makeTransformers
    );
    // posZ は fixture mapping にない
    expect(js).toContain("e.posZ");
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM003"))).toBe(true);
  });
});
