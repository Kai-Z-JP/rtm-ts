import ts from "typescript";
import { MappingJson, lookupField, lookupMethod, typeToDescriptor } from "../mappings.js";
import { RTM_DIAGNOSTICS } from "../diagnostics.js";

/**
 * TypeChecker を使って MCP名フィールド/メソッドを SRG名に変換する。
 * any / unknown 型の場合は RTM002 warning を出して変換しない。
 */
export function createMcpToSrgTransformer(
  checker: ts.TypeChecker,
  mappings: MappingJson,
  diagnostics: ts.Diagnostic[]
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visit: ts.Visitor = (node) => {
      // プロパティアクセス: e.posX, e.getDistance(...)
      if (ts.isPropertyAccessExpression(node)) {
        const obj = node.expression;
        const propName = node.name.text;

        const objType = checker.getTypeAtLocation(obj);
        const fqn = getClassFqn(objType, checker);

        if (!fqn) {
          // any/unknown → RTM002
          if (isAnyOrUnknown(objType)) {
            diagnostics.push(RTM_DIAGNOSTICS.RTM002(node.name));
          }
          return ts.visitEachChild(node, visit, context);
        }

        // メソッド呼び出しかフィールドアクセスかは親ノードで判断するため
        // ここではフィールドとして試みる。メソッドは CallExpression 側で処理。
        // 継承チェーンを辿って SRG フィールド名を検索
        const srgField = lookupFieldInHierarchy(mappings, objType, propName, checker);
        if (srgField) {
          return ts.factory.createPropertyAccessExpression(
            ts.visitNode(obj, visit) as ts.Expression,
            srgField
          );
        }
        // mapping 対象クラス(直接エントリあり)で field が見つからない → RTM003
        if (mappings.classes[fqn]) {
          diagnostics.push(RTM_DIAGNOSTICS.RTM003(node.name, `${fqn}#${propName}`));
        }

        return ts.visitEachChild(node, visit, context);
      }

      // メソッド呼び出し: e.getDistance(0, 64, 0)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const propAccess = node.expression;
        const obj = propAccess.expression;
        const methodName = propAccess.name.text;

        const objType = checker.getTypeAtLocation(obj);
        const fqn = getClassFqn(objType, checker);

        if (!fqn) {
          return ts.visitEachChild(node, visit, context);
        }

        const args = node.arguments;
        const argTypes = args.map((a) => {
          const t = checker.getTypeAtLocation(a);
          return typeToDescriptor(checker.typeToString(t));
        });
        const retType = checker.getReturnTypeOfSignature(
          checker.getResolvedSignature(node) ?? getFirstSignature(objType, methodName, checker)!
        );
        const retDesc = retType ? typeToDescriptor(checker.typeToString(retType)) : "V";

        const descriptor = `${methodName}(${argTypes.join("")})${retDesc}`;
        const srgMethod = lookupMethodInHierarchy(mappings, objType, descriptor, checker);

        const visitedArgs = args.map((a) => ts.visitNode(a, visit) as ts.Expression);
        const visitedObj = ts.visitNode(obj, visit) as ts.Expression;

        if (srgMethod) {
          return ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(visitedObj, srgMethod),
            undefined,
            visitedArgs
          );
        }

        return ts.factory.updateCallExpression(
          node,
          ts.factory.createPropertyAccessExpression(visitedObj, methodName),
          node.typeArguments,
          visitedArgs
        );
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };
}

function lookupFieldInHierarchy(
  mappings: MappingJson,
  type: ts.Type,
  fieldName: string,
  checker: ts.TypeChecker
): string | undefined {
  const fqn = getClassFqn(type, checker);
  if (fqn) {
    const found = lookupField(mappings, fqn, fieldName);
    if (found) return found;
  }
  for (const base of type.getBaseTypes() ?? []) {
    const found = lookupFieldInHierarchy(mappings, base, fieldName, checker);
    if (found) return found;
  }
  return undefined;
}

function lookupMethodInHierarchy(
  mappings: MappingJson,
  type: ts.Type,
  descriptor: string,
  checker: ts.TypeChecker
): string | undefined {
  const fqn = getClassFqn(type, checker);
  if (fqn) {
    const found = lookupMethod(mappings, fqn, descriptor);
    if (found) return found;
  }
  for (const base of type.getBaseTypes() ?? []) {
    const found = lookupMethodInHierarchy(mappings, base, descriptor, checker);
    if (found) return found;
  }
  return undefined;
}

function isAnyOrUnknown(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown);
}

function getClassFqn(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  if (isAnyOrUnknown(type)) return undefined;
  const sym = type.getSymbol();
  if (!sym) return undefined;
  const tsName = checker
    .getFullyQualifiedName(sym)
    .replace(/"/g, "")
    .replace(/^module:/, "");
  return tsName;
}

function getFirstSignature(
  type: ts.Type,
  methodName: string,
  checker: ts.TypeChecker
): ts.Signature | undefined {
  const prop = type.getProperty(methodName);
  if (!prop) return undefined;
  const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);
  return propType.getCallSignatures()[0];
}
