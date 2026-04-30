import ts from "typescript";
import {
  MappingJson,
  lookupField,
  lookupMethod,
  lookupMethodByNameAndArgs,
  typeToDescriptor,
} from "../mappings.js";
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
          return typeToDescriptorFromType(t, checker);
        });
        const retType = checker.getReturnTypeOfSignature(
          checker.getResolvedSignature(node) ?? getFirstSignature(objType, methodName, checker)!
        );
        const retDesc = retType ? typeToDescriptorFromType(retType, checker) : "V";

        const descriptor = `${methodName}(${argTypes.join("")})${retDesc}`;
        const srgMethod = lookupMethodInHierarchy(
          mappings,
          objType,
          descriptor,
          methodName,
          argTypes,
          checker
        );

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
  for (const base of getBaseTypes(type)) {
    const found = lookupFieldInHierarchy(mappings, base, fieldName, checker);
    if (found) return found;
  }
  return undefined;
}

function lookupMethodInHierarchy(
  mappings: MappingJson,
  type: ts.Type,
  descriptor: string,
  methodName: string,
  argDescriptors: string[],
  checker: ts.TypeChecker
): string | undefined {
  const fqn = getClassFqn(type, checker);
  if (fqn) {
    const found = lookupMethod(mappings, fqn, descriptor);
    if (found) return found;
    const fuzzyFound = lookupMethodByNameAndArgs(mappings, fqn, methodName, argDescriptors);
    if (fuzzyFound) return fuzzyFound;
  }
  for (const base of getBaseTypes(type)) {
    const found = lookupMethodInHierarchy(
      mappings,
      base,
      descriptor,
      methodName,
      argDescriptors,
      checker
    );
    if (found) return found;
  }
  return undefined;
}

function getBaseTypes(type: ts.Type): ts.BaseType[] {
  const bases = type.getBaseTypes() ?? [];
  if (bases.length > 0) return bases;

  const target = (type as ts.TypeReference).target;
  if (target && target !== type) {
    return target.getBaseTypes() ?? [];
  }

  return [];
}

function isAnyOrUnknown(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown);
}

function getClassFqn(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  if (isAnyOrUnknown(type)) return undefined;
  const constructSignature = type.getConstructSignatures()[0];
  if (constructSignature) {
    return getClassFqn(constructSignature.getReturnType(), checker);
  }
  const sym = type.getSymbol();
  if (!sym) return undefined;
  const tsName = checker
    .getFullyQualifiedName(sym)
    .replace(/"/g, "")
    .replace(/^module:/, "");
  return tsName;
}

function typeToDescriptorFromType(type: ts.Type, checker: ts.TypeChecker): string {
  if (isAnyOrUnknown(type)) return typeToDescriptor(checker.typeToString(type));

  if (type.flags & ts.TypeFlags.NumberLike) return "D";
  if (type.flags & ts.TypeFlags.BooleanLike) return "Z";
  if (type.flags & ts.TypeFlags.StringLike) return "Ljava/lang/String;";
  if (type.flags & ts.TypeFlags.Void) return "V";

  const fqn = getClassFqn(type, checker);
  if (fqn) return `L${fqn.replace(/\./g, "/")};`;

  return typeToDescriptor(checker.typeToString(type));
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
