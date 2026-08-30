import ts from "typescript";

/**
 * Runtime string and regular expression literals containing non-ASCII
 * characters are emitted using `\uXXXX` escapes.
 *
 * Module specifiers must keep their source representation because the
 * post-emit include conversion resolves the emitted text as a file path.
 */
export function createUnicodeEscapeTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isStringLiteral(node) && containsNonAscii(node.text)) {
        if (isModuleSpecifier(node)) {
          // The CommonJS downlevel transform otherwise synthesizes an escaped
          // require path, which the post-emit include resolver cannot resolve.
          ts.setEmitFlags(node, ts.EmitFlags.NoAsciiEscaping);
          return node;
        }

        const sourceFile = node.pos >= 0 ? node.getSourceFile() : undefined;
        const isSingleQuote =
          sourceFile !== undefined &&
          sourceFile.text.charCodeAt(node.getStart(sourceFile)) === "'".charCodeAt(0);
        const escaped = ts.factory.createStringLiteral(node.text, isSingleQuote);

        // Preserve comments and source-map locations without making the new
        // literal eligible for verbatim source-text reuse.
        ts.setCommentRange(escaped, node);
        ts.setSourceMapRange(escaped, node);
        return escaped;
      }

      if (ts.isRegularExpressionLiteral(node) && containsNonAscii(node.text)) {
        const escaped = ts.factory.createRegularExpressionLiteral(
          escapeRegularExpressionNonAscii(node.text)
        );

        ts.setCommentRange(escaped, node);
        ts.setSourceMapRange(escaped, node);
        return escaped;
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };
}

function escapeRegularExpressionNonAscii(text: string): string {
  let escaped = "";
  let consecutiveBackslashes = 0;

  for (let i = 0; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i);
    if (codeUnit <= 0x7f) {
      escaped += text[i];
      consecutiveBackslashes = text[i] === "\\" ? consecutiveBackslashes + 1 : 0;
      continue;
    }

    // In non-Unicode regexes, a backslash followed by a non-ASCII character
    // can be an identity escape (for example /\日/). Reuse that backslash
    // instead of adding another one so the matched pattern stays unchanged.
    if (consecutiveBackslashes % 2 === 0) escaped += "\\";
    escaped += `u${codeUnit.toString(16).toUpperCase().padStart(4, "0")}`;
    consecutiveBackslashes = 0;
  }

  return escaped;
}

function containsNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

function isModuleSpecifier(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  ) {
    return true;
  }

  if (ts.isExternalModuleReference(parent) && parent.expression === node) {
    return true;
  }

  if (
    ts.isCallExpression(parent) &&
    parent.arguments[0] === node &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(parent.expression) && parent.expression.text === "require"))
  ) {
    return true;
  }

  return false;
}
