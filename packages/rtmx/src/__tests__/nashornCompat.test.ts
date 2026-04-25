import { describe, it, expect } from "vitest";
import ts from "typescript";
import { createNashornCompatTransformer } from "../transformers/nashornCompat.js";
import { transform } from "./testHelper.js";

const makeTransformers = (_checker: ts.TypeChecker, diags: ts.Diagnostic[]) => ({
  before: [createNashornCompatTransformer(diags)],
});

describe("nashornCompat", () => {
  it("async/await は RTM004 diagnostic を出す", () => {
    const { diagnostics } = transform(
      `async function f() { await Promise.resolve(1); }`,
      makeTransformers
    );
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM004"))).toBe(true);
  });

  it("new Promise は RTM004 diagnostic を出す", () => {
    const { diagnostics } = transform(`const p = new Promise((r) => r(1));`, makeTransformers);
    expect(diagnostics.some((d) => (d.messageText as string).includes("RTM004"))).toBe(true);
  });

  it("通常のコードは diagnostic を出さない", () => {
    const { diagnostics } = transform(`var x = 1; var y = x + 2;`, makeTransformers);
    expect(diagnostics.filter((d) => (d.messageText as string).includes("RTM004"))).toHaveLength(0);
  });
});
