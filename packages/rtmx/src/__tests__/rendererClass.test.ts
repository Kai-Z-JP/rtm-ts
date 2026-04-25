import { describe, it, expect } from "vitest";
import ts from "typescript";
import { createRendererClassTransformer } from "../transformers/rendererClass.js";
import { transform } from "./testHelper.js";

const makeTransformers = (checker: ts.TypeChecker) => ({
  before: [createRendererClassTransformer(checker)],
});

describe("rendererClass", () => {
  it("declare const renderer: T から renderClass を生成する", () => {
    const { js } = transform(
      `import { TrainModelRenderer } from "jp.ngt.rtm.render";
declare const renderer: TrainModelRenderer;`,
      makeTransformers
    );
    expect(js).toContain('var renderClass = "jp.ngt.rtm.render.TrainModelRenderer"');
  });

  it("declare でない renderer は変換しない", () => {
    const { js } = transform(`const renderer = {} as any;`, makeTransformers);
    expect(js).not.toContain("renderClass");
  });

  it("renderClass が出力の先頭付近に来る", () => {
    const { js } = transform(
      `import { TrainModelRenderer } from "jp.ngt.rtm.render";
declare const renderer: TrainModelRenderer;
const x = 1;`,
      makeTransformers
    );
    const rcIdx = js.indexOf("var renderClass");
    const xIdx = js.indexOf("var x");
    expect(rcIdx).toBeGreaterThanOrEqual(0);
    expect(rcIdx).toBeLessThan(xIdx);
  });
});
