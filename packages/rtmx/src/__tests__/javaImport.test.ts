import { describe, it, expect } from "vitest";
import ts from "typescript";
import { createJavaImportTransformer } from "../transformers/javaImportToPackages.js";
import { transform } from "./testHelper.js";

const makeTransformers = (checker: ts.TypeChecker, diags: ts.Diagnostic[]) => ({
  before: [createJavaImportTransformer(checker, diags)],
});

describe("javaImportToPackages", () => {
  it("runtime value import は var Packages... に変換される", () => {
    const { js } = transform(
      `import { GL11 } from "org.lwjgl.opengl";
GL11.glDisable(0);`,
      makeTransformers
    );
    expect(js).toContain("var GL11 = Packages.org.lwjgl.opengl.GL11;");
    expect(js).toContain("GL11.glDisable(0)");
    expect(js).not.toContain("require(");
  });

  it("型のみ import は var を出力しない", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const e: Entity = renderer as any;`,
      makeTransformers
    );
    expect(js).not.toContain("var Entity");
    expect(js).not.toContain("Packages.net.minecraft.entity.Entity");
  });

  it("runtime value として使われる import は var を出力する", () => {
    const { js } = transform(
      `import { Entity } from "net.minecraft.entity";
const clazz = Entity;`,
      makeTransformers
    );
    expect(js).toContain("var Entity = Packages.net.minecraft.entity.Entity;");
  });

  it("default import は RTM001 diagnostic を出す", () => {
    const { diagnostics } = transform(`import GL11 from "org.lwjgl.opengl";`, makeTransformers);
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM001"))).toBe(true);
  });

  it("namespace import は RTM001 diagnostic を出す", () => {
    const { diagnostics } = transform(
      `import * as opengl from "org.lwjgl.opengl";`,
      makeTransformers
    );
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM001"))).toBe(true);
  });
});
