import ts from "typescript";
import { RTM_DIAGNOSTICS } from "../diagnostics.js";

/**
 * Java import の diagnostic 検査のみ行う。
 * var Packages 変換は compile.ts の stripModuleBoilerplate で行う。
 */
export function createJavaImportTransformer(
  checker: ts.TypeChecker,
  diagnostics: ts.Diagnostic[]
): ts.TransformerFactory<ts.SourceFile> {
  void checker;
  return () => (sourceFile) => {
    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const moduleSpec = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpec)) continue;
      const moduleName = moduleSpec.text;

      if (moduleName.startsWith(".")) {
        // 相対 import は //include に変換するため全て許可
        continue;
      }

      const clause = stmt.importClause;
      if (!clause) continue;
      if (!clause.namedBindings || ts.isNamespaceImport(clause.namedBindings) || clause.name) {
        diagnostics.push(RTM_DIAGNOSTICS.RTM001(stmt));
      }
    }
    return sourceFile;
  };
}
