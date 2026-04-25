import ts from "typescript";
import { RTM_DIAGNOSTICS } from "../diagnostics.js";

const NASHORN_WARNINGS: Array<{
  check: (node: ts.Node) => boolean;
  detail: string;
}> = [
  {
    check: (n) => ts.isAwaitExpression(n) || ts.isAwaitKeyword(n as ts.Token<ts.SyntaxKind>),
    detail: "async/await is not supported in Nashorn",
  },
  {
    check: (n) =>
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ["Promise", "Map", "Set", "Symbol", "Proxy"].includes(n.expression.text),
    detail: "Promise/Map/Set/Symbol/Proxy are not supported in Nashorn",
  },
];

export function createNashornCompatTransformer(
  diagnostics: ts.Diagnostic[]
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visit: ts.Visitor = (node) => {
      for (const w of NASHORN_WARNINGS) {
        if (w.check(node)) {
          diagnostics.push(RTM_DIAGNOSTICS.RTM004(node, w.detail));
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };
}
