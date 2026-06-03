import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import type { MultiTargetConfig, RtmxConfig } from "./config.js";
import { RTM_DIAGNOSTICS } from "./diagnostics.js";
import { loadMappings } from "./mappings.js";

export interface CommonApiAvailability {
  targets: string[];
  label: string;
  reason: "availability" | "mapping";
}

export interface CommonApiManifest {
  version: 1;
  targets: string[];
  classes: Record<string, CommonApiAvailability>;
  members: Record<string, CommonApiAvailability>;
}

interface TypingDeclaration {
  key: string;
  kind: "class" | "member";
  label: string;
  owner?: string;
  memberName?: string;
  signature?: string;
  start: number;
  indent: string;
}

interface ParsedTypingFile {
  fileName: string;
  text: string;
  declarations: TypingDeclaration[];
  classBases: Map<string, string[]>;
}

const GENERATED_ANNOTATION =
  /^[ \t]*\/\*\*\r?\n[ \t]* \* @deprecated (?:target-specific API\. Available targets: [^\r\n]+|target-dependent SRG mapping\.)\r?\n[ \t]* \* @rtmx-target-specific [^\r\n]+\r?\n[ \t]* \*\/\r?\n/gm;

export function generateCommonApiMetadata(config: MultiTargetConfig): void {
  const targetFiles = new Map<string, ParsedTypingFile[]>();
  const availability = new Map<string, { declaration: TypingDeclaration; targets: Set<string> }>();
  const targetNames = Object.keys(config.targets);
  const mappingSensitiveMembers = findMappingSensitiveMembers(config.targets);
  const targetClassMembers = new Map<string, Map<string, Set<string>>>();
  const targetClassBases = new Map<string, Map<string, string[]>>();
  const targetClasses = new Map<string, Set<string>>();

  for (const [targetName, target] of Object.entries(config.targets)) {
    const files = target.typings.flatMap(expandGlob).sort();
    if (files.length === 0) {
      throw new Error(
        `No typings found for multi-target '${targetName}'. Run rtmx generate first.`
      );
    }

    const parsedFiles = files.map(parseTypingFile);
    targetFiles.set(targetName, parsedFiles);
    targetClassMembers.set(targetName, collectClassMembers(parsedFiles));
    targetClassBases.set(targetName, collectClassBases(parsedFiles));
    targetClasses.set(targetName, collectClasses(parsedFiles));
    for (const file of parsedFiles) {
      for (const declaration of file.declarations) {
        const entry = availability.get(declaration.key) ?? {
          declaration,
          targets: new Set<string>(),
        };
        entry.targets.add(targetName);
        availability.set(declaration.key, entry);
      }
    }
  }

  for (const entry of availability.values()) {
    const declaration = entry.declaration;
    if (declaration.kind !== "member" || !declaration.owner || !declaration.signature) continue;
    for (const targetName of targetNames) {
      if (entry.targets.has(targetName)) continue;
      if (!targetClasses.get(targetName)?.has(declaration.owner)) continue;
      if (
        hasInheritedMember(
          targetName,
          declaration.owner,
          declaration.signature,
          targetClassMembers,
          targetClassBases
        )
      ) {
        entry.targets.add(targetName);
      }
    }
  }

  const manifest: CommonApiManifest = {
    version: 1,
    targets: targetNames,
    classes: {},
    members: {},
  };

  for (const [key, entry] of availability) {
    const mappingSensitive =
      entry.targets.size === targetNames.length &&
      entry.declaration.kind === "member" &&
      entry.declaration.owner &&
      entry.declaration.memberName &&
      mappingSensitiveMembers.has(`${entry.declaration.owner}#${entry.declaration.memberName}`);
    if (entry.targets.size === targetNames.length && !mappingSensitive) continue;
    const value = {
      targets: [...entry.targets].sort(),
      label: entry.declaration.label,
      reason: mappingSensitive ? ("mapping" as const) : ("availability" as const),
    };
    if (entry.declaration.kind === "class") {
      manifest.classes[key] = value;
    } else {
      manifest.members[key] = value;
    }
  }

  fs.rmSync(config.commonApiTypingsDir, { recursive: true, force: true });
  for (const files of targetFiles.values()) {
    for (const file of files) {
      fs.mkdirSync(path.dirname(file.fileName), { recursive: true });
      fs.writeFileSync(file.fileName, file.text, "utf-8");
    }
  }

  if (targetNames.length === 0) {
    throw new Error("Multi-target config must define at least one target.");
  }
  for (const file of mergeTypingFiles(targetFiles)) {
      const annotations = file.declarations
        .filter((declaration) => {
          if (declaration.kind === "class") return declaration.key in manifest.classes;
          return (
            declaration.key in manifest.members &&
            (!declaration.owner || !(classKey(declaration.owner) in manifest.classes))
          );
        })
        .map((declaration) => ({
          start: declaration.start,
          text: makeAnnotation(declaration.indent, declaration.key, manifest),
        }))
        .sort((a, b) => b.start - a.start);

      let text = file.text;
      for (const annotation of annotations) {
        text = text.slice(0, annotation.start) + annotation.text + text.slice(annotation.start);
      }
      const commonTypingFile = path.join(config.commonApiTypingsDir, path.basename(file.fileName));
      fs.mkdirSync(path.dirname(commonTypingFile), { recursive: true });
      fs.writeFileSync(commonTypingFile, text, "utf-8");
  }

  fs.mkdirSync(path.dirname(config.commonApiManifest), { recursive: true });
  fs.writeFileSync(config.commonApiManifest, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`[rtmx] Common API metadata -> ${config.commonApiManifest}`);
}

export function collectCommonApiDiagnostics(
  program: ts.Program,
  checker: ts.TypeChecker,
  config: RtmxConfig
): ts.Diagnostic[] {
  if (!config.commonApiManifest || !config.commonSrcDir) return [];
  if (!fs.existsSync(config.commonApiManifest)) return [];

  const manifest = JSON.parse(
    fs.readFileSync(config.commonApiManifest, "utf-8")
  ) as CommonApiManifest;
  const diagnostics: ts.Diagnostic[] = [];
  const seen = new Set<string>();

  const report = (node: ts.Node, availability: CommonApiAvailability | undefined) => {
    if (!availability) return;
    const key = `${node.getSourceFile().fileName}:${node.getStart()}:${availability.label}`;
    if (!seen.add(key)) return;
    diagnostics.push(
      RTM_DIAGNOSTICS.RTM005(
        node,
        availability.label,
        availability.targets,
        availability.reason,
        config.commonApiPolicy ?? "allow"
      )
    );
  };

  const reportClass = (node: ts.Node, declaration: ts.Declaration | undefined) => {
    const key = declaration && classKeyFromDeclaration(declaration);
    if (key) report(node, manifest.classes[key]);
  };

  const reportMember = (node: ts.Node, declaration: ts.Declaration | undefined) => {
    if (!declaration) return;
    const owner = ownerNameFromMember(declaration);
    if (owner && manifest.classes[classKey(owner)]) return;
    const key = memberKeyFromDeclaration(declaration);
    if (key) report(node, manifest.members[key]);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const symbol = resolveAlias(checker.getSymbolAtLocation(node.name), checker);
      reportClass(node.name, symbol?.declarations?.find(isClassLikeDeclaration));
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      reportMember(node.expression.name, checker.getResolvedSignature(node)?.getDeclaration());
    } else if (ts.isNewExpression(node)) {
      reportMember(node.expression, checker.getResolvedSignature(node)?.getDeclaration());
    } else if (
      ts.isPropertyAccessExpression(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      const symbol = resolveAlias(checker.getSymbolAtLocation(node.name), checker);
      reportMember(
        node.name,
        symbol?.declarations?.find(
          (declaration) => memberKeyFromDeclaration(declaration) !== undefined
        )
      );
    }

    ts.forEachChild(node, visit);
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !isInsideDir(sourceFile.fileName, config.commonSrcDir)) {
      continue;
    }
    visit(sourceFile);
  }

  return diagnostics;
}

function parseTypingFile(fileName: string): ParsedTypingFile {
  const text = fs.readFileSync(fileName, "utf-8").replace(GENERATED_ANNOTATION, "");
  return parseTypingText(fileName, text);
}

function parseTypingText(fileName: string, text: string): ParsedTypingFile {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declarations: TypingDeclaration[] = [];
  const classBases = new Map<string, string[]>();

  const visit = (node: ts.Node): void => {
    if (isClassLikeDeclaration(node) && node.name) {
      const owner = declarationName(node);
      if (owner) {
        classBases.set(owner, heritageTypeNames(node));
        declarations.push({
          key: classKey(owner),
          kind: "class",
          label: owner,
          start: getLineStart(text, node.getStart(sourceFile)),
          indent: getIndent(text, node.getStart(sourceFile)),
        });
        for (const member of node.members) {
          const key = memberKeyFromDeclaration(member);
          if (!key) continue;
          declarations.push({
            key,
            kind: "member",
            label: memberLabel(member),
            owner,
            memberName: memberName(member),
            signature: memberSignature(member),
            start: getLineStart(text, member.getStart(sourceFile)),
            indent: getIndent(text, member.getStart(sourceFile)),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { fileName, text, declarations, classBases };
}

function makeAnnotation(
  indent: string,
  key: string,
  manifest: CommonApiManifest
): string {
  const availability = manifest.classes[key] ?? manifest.members[key];
  if (!availability) return "";
  const targets = availability.targets.join(", ");
  const deprecated =
    availability.reason === "mapping"
      ? "target-dependent SRG mapping."
      : `target-specific API. Available targets: ${targets}`;
  return [
    `${indent}/**`,
    `${indent} * @deprecated ${deprecated}`,
    `${indent} * @rtmx-target-specific ${targets}`,
    `${indent} */`,
    "",
  ].join("\n");
}

function mergeTypingFiles(targetFiles: Map<string, ParsedTypingFile[]>): ParsedTypingFile[] {
  const filesByName = new Map<string, ParsedTypingFile[]>();
  for (const files of targetFiles.values()) {
    for (const file of files) {
      const fileName = path.basename(file.fileName);
      const entries = filesByName.get(fileName) ?? [];
      entries.push(file);
      filesByName.set(fileName, entries);
    }
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return [...filesByName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fileName, files]) => {
      const sourceFiles = files.map((file) =>
        ts.createSourceFile(fileName, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      );
      const sourceFile = sourceFiles[0];
      const statements = mergeStatements(sourceFiles.map((file) => file.statements)).map(
        synthesizeNode
      );
      const merged = ts.factory.updateSourceFile(sourceFile, statements);
      const text = printer.printFile(merged);
      return parseTypingText(path.join(fileName), text);
    });
}

function mergeStatements(statementLists: readonly ts.NodeArray<ts.Statement>[]): ts.Statement[] {
  const result: ts.Statement[] = [];
  const byKey = new Map<string, number>();

  for (const statements of statementLists) {
    for (const statement of statements) {
      const key = statementKey(statement);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, result.length);
        result.push(statement);
      } else {
        result[existing] = mergeStatement(result[existing], statement);
      }
    }
  }

  return result;
}

function mergeStatement(existing: ts.Statement, incoming: ts.Statement): ts.Statement {
  if (ts.isModuleDeclaration(existing) && ts.isModuleDeclaration(incoming)) {
    return mergeModuleDeclaration(existing, incoming);
  }
  if (ts.isClassDeclaration(existing) && ts.isClassDeclaration(incoming)) {
    return ts.factory.updateClassDeclaration(
      existing,
      existing.modifiers,
      existing.name,
      existing.typeParameters,
      existing.heritageClauses,
      mergeClassElements(existing.members, incoming.members)
    );
  }
  if (ts.isInterfaceDeclaration(existing) && ts.isInterfaceDeclaration(incoming)) {
    return ts.factory.updateInterfaceDeclaration(
      existing,
      existing.modifiers,
      existing.name,
      existing.typeParameters,
      existing.heritageClauses,
      mergeTypeElements(existing.members, incoming.members)
    );
  }
  return existing;
}

function mergeModuleDeclaration(
  existing: ts.ModuleDeclaration,
  incoming: ts.ModuleDeclaration
): ts.ModuleDeclaration {
  if (existing.body && incoming.body && ts.isModuleBlock(existing.body) && ts.isModuleBlock(incoming.body)) {
    return ts.factory.updateModuleDeclaration(
      existing,
      existing.modifiers,
      existing.name,
      ts.factory.updateModuleBlock(
        existing.body,
        mergeStatements([existing.body.statements, incoming.body.statements])
      )
    );
  }
  if (
    existing.body &&
    incoming.body &&
    ts.isModuleDeclaration(existing.body) &&
    ts.isModuleDeclaration(incoming.body)
  ) {
    return ts.factory.updateModuleDeclaration(
      existing,
      existing.modifiers,
      existing.name,
      mergeModuleDeclaration(existing.body, incoming.body) as ts.NamespaceDeclaration
    );
  }
  return existing;
}

function mergeClassElements(
  existing: ts.NodeArray<ts.ClassElement>,
  incoming: ts.NodeArray<ts.ClassElement>
): ts.ClassElement[] {
  return mergeElements(existing, incoming);
}

function mergeTypeElements(
  existing: ts.NodeArray<ts.TypeElement>,
  incoming: ts.NodeArray<ts.TypeElement>
): ts.TypeElement[] {
  return mergeElements(existing, incoming);
}

function mergeElements<T extends ts.Node>(
  existing: ts.NodeArray<T>,
  incoming: ts.NodeArray<T>
): T[] {
  const result = [...existing];
  const keys = new Set(existing.map(normalizeDeclaration));
  for (const element of incoming) {
    const key = normalizeDeclaration(element);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(element);
  }
  return result;
}

function statementKey(statement: ts.Statement): string {
  if (ts.isModuleDeclaration(statement)) return `module:${statement.name.getText()}`;
  if (ts.isClassDeclaration(statement) && statement.name) return `class:${statement.name.text}`;
  if (ts.isInterfaceDeclaration(statement)) return `interface:${statement.name.text}`;
  return `text:${normalizeDeclaration(statement)}`;
}

function synthesizeNode<T extends ts.Node>(node: T): T {
  const visit = (current: ts.Node): void => {
    ts.setTextRange(current, { pos: -1, end: -1 });
    ts.forEachChild(current, visit);
  };
  visit(node);
  return node;
}

function collectClasses(files: ParsedTypingFile[]): Set<string> {
  const result = new Set<string>();
  for (const file of files) {
    for (const declaration of file.declarations) {
      if (declaration.kind === "class") result.add(declaration.label);
    }
  }
  return result;
}

function collectClassMembers(files: ParsedTypingFile[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const file of files) {
    for (const declaration of file.declarations) {
      if (declaration.kind !== "member" || !declaration.owner || !declaration.signature) continue;
      const members = result.get(declaration.owner) ?? new Set<string>();
      members.add(declaration.signature);
      result.set(declaration.owner, members);
    }
  }
  return result;
}

function collectClassBases(files: ParsedTypingFile[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of files) {
    for (const [name, bases] of file.classBases) {
      result.set(name, bases);
    }
  }
  return result;
}

function hasInheritedMember(
  targetName: string,
  owner: string,
  signature: string,
  targetClassMembers: Map<string, Map<string, Set<string>>>,
  targetClassBases: Map<string, Map<string, string[]>>
): boolean {
  const membersByClass = targetClassMembers.get(targetName);
  const basesByClass = targetClassBases.get(targetName);
  if (!membersByClass || !basesByClass) return false;

  const seen = new Set<string>();
  const stack = [...(basesByClass.get(owner) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (membersByClass.get(current)?.has(signature)) return true;
    stack.push(...(basesByClass.get(current) ?? []));
  }
  return false;
}

function expandGlob(pattern: string): string[] {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!base.includes("*")) return fs.existsSync(pattern) ? [pattern] : [];
  if (!fs.existsSync(dir)) return [];
  const suffix = base.replace(/\*/g, "");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(suffix))
    .map((file) => path.join(dir, file));
}

function classKey(name: string): string {
  return `class:${name}`;
}

function memberKeyFromDeclaration(declaration: ts.Declaration): string | undefined {
  if (!isApiMember(declaration)) return undefined;
  const owner = ownerNameFromMember(declaration);
  if (!owner) return undefined;
  return `member:${owner}#${memberSignature(declaration)}`;
}

function classKeyFromDeclaration(declaration: ts.Declaration): string | undefined {
  if (!isClassLikeDeclaration(declaration)) return undefined;
  const name = declarationName(declaration);
  return name ? classKey(name) : undefined;
}

function ownerNameFromMember(declaration: ts.Declaration): string | undefined {
  const owner = declaration.parent;
  return isClassLikeDeclaration(owner) ? declarationName(owner) : undefined;
}

function declarationName(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration
): string | undefined {
  if (!declaration.name) return undefined;
  const names = [declaration.name.text];
  let current: ts.Node | undefined = declaration.parent;
  while (current) {
    if (ts.isModuleDeclaration(current)) {
      names.unshift(current.name.text);
    }
    current = current.parent;
  }
  return names.join(".");
}

function normalizeDeclaration(declaration: ts.Node): string {
  return declaration
    .getText()
    .replace(/\boverride\s+/g, "")
    .replace(/\babstract\s+/g, "")
    .replace(/<[^<>(){};]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function memberSignature(declaration: ts.Node): string {
  return normalizeDeclaration(declaration);
}

function heritageTypeNames(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration
): string[] {
  const result: string[] = [];
  for (const clause of declaration.heritageClauses ?? []) {
    for (const type of clause.types) {
      const name = normalizeHeritageText(type.expression.getText());
      if (name) result.push(name);
    }
  }
  return result;
}

function normalizeHeritageText(text: string): string {
  return text.replace(/<[^<>(){};]+>/g, "").trim();
}

function memberLabel(declaration: ts.Declaration): string {
  const owner = ownerNameFromMember(declaration) ?? "unknown";
  const name = memberName(declaration) ?? normalizeDeclaration(declaration);
  return `${owner}#${name}`;
}

function memberName(declaration: ts.Declaration): string | undefined {
  if (ts.isConstructorDeclaration(declaration)) return "constructor";
  const name = (declaration as ts.NamedDeclaration).name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function isClassLikeDeclaration(
  declaration: ts.Node
): declaration is ts.ClassDeclaration | ts.InterfaceDeclaration {
  return ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration);
}

function isApiMember(declaration: ts.Node): declaration is ts.Declaration {
  return (
    ts.isConstructorDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isMethodSignature(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isSetAccessorDeclaration(declaration)
  );
}

function resolveAlias(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function getIndent(text: string, start: number): string {
  const lineStart = getLineStart(text, start);
  return /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? "";
}

function getLineStart(text: string, start: number): number {
  return text.lastIndexOf("\n", start - 1) + 1;
}

function isInsideDir(fileName: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(fileName));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function findMappingSensitiveMembers(targets: Record<string, RtmxConfig>): Set<string> {
  const mappings = Object.values(targets).map((target) => loadMappings(target.mapping));
  const result = new Set<string>();
  const owners = new Set(mappings.flatMap((mapping) => Object.keys(mapping.classes)));

  for (const owner of owners) {
    const classes = mappings.map((mapping) => mapping.classes[owner]);
    const fields = new Set(classes.flatMap((cls) => Object.keys(cls?.fields ?? {})));
    for (const field of fields) {
      if (hasDifferentSrgNames(classes.map((cls) => cls?.fields[field]?.srg))) {
        result.add(`${owner}#${field}`);
      }
    }

    const methods = new Set(classes.flatMap((cls) => Object.keys(cls?.methods ?? {})));
    for (const method of methods) {
      if (hasDifferentSrgNames(classes.map((cls) => cls?.methods[method]?.srg))) {
        result.add(`${owner}#${methodNameFromMappingKey(method)}`);
      }
    }
  }

  return result;
}

function hasDifferentSrgNames(names: Array<string | undefined>): boolean {
  return names.every((name): name is string => !!name) && new Set(names).size > 1;
}

function methodNameFromMappingKey(key: string): string {
  const paren = key.indexOf("(");
  return paren >= 0 ? key.slice(0, paren) : key;
}
