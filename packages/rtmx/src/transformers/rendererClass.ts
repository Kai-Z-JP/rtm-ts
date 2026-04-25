import ts from "typescript";

/**
 * `declare const renderer: SomeClass` を検出し、
 * TypeChecker で FQN を解決して `var renderClass = "pkg.SomeClass";` を出力する。
 *
 * RTM は起動時に renderClass フィールドを読んで該当クラスをインスタンス化する。
 * declare const なので TypeScript は何も emit しないが、
 * このトランスフォーマーが renderClass 宣言を代わりに生成する。
 */
export function createRendererClassTransformer(
  checker: ts.TypeChecker
): ts.TransformerFactory<ts.SourceFile> {
  return () => (sourceFile) => {
    const extras: ts.Statement[] = [];

    for (const stmt of sourceFile.statements) {
      if (!isDeclareConst(stmt, "renderer")) continue;

      const varStmt = stmt as ts.VariableStatement;
      const decl = varStmt.declarationList.declarations[0];
      if (!decl.type) continue;

      const type = checker.getTypeAtLocation(decl.type);
      const sym = type.getSymbol();
      if (!sym) continue;

      const fqn = resolveJavaFqn(checker.getFullyQualifiedName(sym));
      if (!fqn) continue;

      // var renderClass = "jp.ngt.rtm.render.TrainModelRenderer";
      extras.push(
        ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(
            [
              ts.factory.createVariableDeclaration(
                "renderClass",
                undefined,
                undefined,
                ts.factory.createStringLiteral(fqn)
              ),
            ],
            ts.NodeFlags.None
          )
        )
      );
    }

    if (extras.length === 0) return sourceFile;

    return ts.factory.updateSourceFile(sourceFile, [...extras, ...sourceFile.statements]);
  };
}

/** `declare const <name>: T` かどうかを判定 */
function isDeclareConst(node: ts.Node, name: string): node is ts.VariableStatement {
  if (!ts.isVariableStatement(node)) return false;
  const mods = ts.getCombinedModifierFlags(node.declarationList.declarations[0]);
  if (!(mods & ts.ModifierFlags.Ambient)) return false;
  const decl = node.declarationList.declarations[0];
  return ts.isIdentifier(decl.name) && decl.name.text === name;
}

/**
 * TypeChecker の getFQN は declare module の場合 `"pkg.name".ClassName` 形式になる。
 * `"net.minecraft.entity".Entity` → `net.minecraft.entity.Entity` に変換する。
 */
function resolveJavaFqn(fqn: string): string | undefined {
  // "pkg.name".ClassName → pkg.name.ClassName  (旧 declare module 形式)
  const m = fqn.match(/^"([^"]+)"\.(.+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  // すでにドット区切りの場合はそのまま
  if (fqn.includes(".")) return fqn;
  return undefined;
}
