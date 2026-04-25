import ts from "typescript";

export const RTM_DIAGNOSTICS = {
  RTM001: (node: ts.Node): ts.Diagnostic => ({
    category: ts.DiagnosticCategory.Error,
    code: 1001,
    messageText: "RTM001: unsupported Java import style (use named imports only)",
    file: node.getSourceFile(),
    start: node.getStart(),
    length: node.getWidth(),
  }),
  RTM002: (node: ts.Node): ts.Diagnostic => ({
    category: ts.DiagnosticCategory.Warning,
    code: 1002,
    messageText: "RTM002: skipped SRG remap because expression type is any or unknown",
    file: node.getSourceFile(),
    start: node.getStart(),
    length: node.getWidth(),
  }),
  RTM003: (node: ts.Node, name: string): ts.Diagnostic => ({
    category: ts.DiagnosticCategory.Warning,
    code: 1003,
    messageText: `RTM003: mapping not found for "${name}"`,
    file: node.getSourceFile(),
    start: node.getStart(),
    length: node.getWidth(),
  }),
  RTM004: (node: ts.Node, detail: string): ts.Diagnostic => ({
    category: ts.DiagnosticCategory.Warning,
    code: 1004,
    messageText: `RTM004: Nashorn incompatible syntax: ${detail}`,
    file: node.getSourceFile(),
    start: node.getStart(),
    length: node.getWidth(),
  }),
};

export function printDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
  for (const d of diagnostics) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const prefix = `${d.file.fileName}:${line + 1}:${character + 1}`;
      const level = d.category === ts.DiagnosticCategory.Error ? "error" : "warning";
      console.error(`${prefix} - ${level}: ${msg}`);
    } else {
      console.error(msg);
    }
  }
}
