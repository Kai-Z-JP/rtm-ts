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
