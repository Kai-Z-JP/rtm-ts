import * as fs from "fs";

export interface FieldMapping {
  srg: string;
  desc?: string;
}

export interface MethodMapping {
  srg: string;
}

export interface ClassMapping {
  srg: string;
  fields: Record<string, FieldMapping>;
  methods: Record<string, MethodMapping>;
}

export interface MappingJson {
  classes: Record<string, ClassMapping>;
}

export function loadMappings(jsonPath: string): MappingJson {
  const raw = fs.readFileSync(jsonPath, "utf-8");
  return JSON.parse(raw) as MappingJson;
}

export function lookupField(
  mappings: MappingJson,
  classFqn: string,
  fieldName: string
): string | undefined {
  return mappings.classes[classFqn]?.fields[fieldName]?.srg;
}

export function hasClass(mappings: MappingJson, classFqn: string): boolean {
  return classFqn in mappings.classes;
}

/** descriptor 形式: "methodName(DDD)D" */
export function lookupMethod(
  mappings: MappingJson,
  classFqn: string,
  methodKey: string
): string | undefined {
  return mappings.classes[classFqn]?.methods[methodKey]?.srg;
}

export function lookupMethodByNameAndArgs(
  mappings: MappingJson,
  classFqn: string,
  methodName: string,
  argDescriptors: string[]
): string | undefined {
  const methods = mappings.classes[classFqn]?.methods;
  if (!methods) return undefined;

  const matches = Object.entries(methods).filter(([key]) => {
    const parsed = parseMethodKey(key);
    return (
      parsed?.name === methodName &&
      parsed.args.length === argDescriptors.length &&
      parsed.args.every((actual, i) => isCompatibleDescriptor(argDescriptors[i], actual))
    );
  });
  return matches.length === 1 ? matches[0][1].srg : undefined;
}

function parseMethodKey(methodKey: string): { name: string; args: string[] } | undefined {
  const match = /^(.+)\((.*)\).+$/.exec(methodKey);
  if (!match) return undefined;
  return { name: match[1], args: parseDescriptorList(match[2]) };
}

function parseDescriptorList(descriptors: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < descriptors.length; ) {
    const start = i;
    while (descriptors[i] === "[") i++;
    if (descriptors[i] === "L") {
      const end = descriptors.indexOf(";", i);
      if (end < 0) return result;
      result.push(descriptors.slice(start, end + 1));
      i = end + 1;
    } else {
      result.push(descriptors.slice(start, i + 1));
      i++;
    }
  }
  return result;
}

function isCompatibleDescriptor(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  return expected === "D" && NUMERIC_PRIMITIVE_DESCRIPTORS.has(actual);
}

const NUMERIC_PRIMITIVE_DESCRIPTORS = new Set(["B", "S", "I", "J", "F", "D"]);

/** TypeScript の型から Java descriptor 文字を生成 (MVP 簡易版) */
export function typeToDescriptor(typeName: string): string {
  // 数値リテラル型 (0, 64, 3.14 など) → number
  if (/^-?\d+(\.\d+)?$/.test(typeName)) return "D";
  // boolean リテラル型
  if (typeName === "true" || typeName === "false") return "Z";

  switch (typeName) {
    case "number":
      return "D";
    case "boolean":
      return "Z";
    case "string":
      return "Ljava/lang/String;";
    case "void":
      return "V";
    default:
      return `L${typeName.replace(/\./g, "/")};`;
  }
}
