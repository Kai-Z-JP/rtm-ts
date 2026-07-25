import { describe, expect, it } from "vitest";
import { createUnicodeEscapeTransformer } from "../transformers/unicodeEscape.js";
import { transform } from "./testHelper.js";

const makeTransformers = () => ({
  before: [createUnicodeEscapeTransformer()],
});

describe("unicodeEscape", () => {
  it("通常文字列の非 ASCII 文字を Unicode escape にする", () => {
    const { js } = transform(
      `const doubleQuoted = "日本語";
const singleQuoted = '値';
const emoji = "😀";`,
      makeTransformers
    );

    expect(js).toContain('var doubleQuoted = "\\u65E5\\u672C\\u8A9E"');
    expect(js).toContain("var singleQuoted = '\\u5024'");
    expect(js).toContain('var emoji = "\\uD83D\\uDE00"');
    expect([...js].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
  });

  it("テンプレートリテラルも従来どおり Unicode escape にする", () => {
    const { js } = transform("const value = 1;\nconst text = `日本語:${value}`;", makeTransformers);

    expect(js).toContain('"\\u65E5\\u672C\\u8A9E:".concat(value)');
  });

  it("モジュール指定子はパス解決のため元の表記を保つ", () => {
    const { js } = transform(
      `import "./日本語";
declare function require(name: string): unknown;
const loaded = require("./値");
const text = "本文";`,
      makeTransformers
    );

    expect(js).toContain('require("./日本語")');
    expect(js).toContain('require("./値")');
    expect(js).toContain('var text = "\\u672C\\u6587"');
  });

  it("文字列に付いたコメントを維持する", () => {
    const { js } = transform(`const text = /* 内側 */ "日本語";`, makeTransformers);

    expect(js).toContain('/* 内側 */ "\\u65E5\\u672C\\u8A9E"');
  });
});
