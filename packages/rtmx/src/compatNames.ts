export function compatModuleKey(modulePath: string): string {
  const safe = modulePath
    .replace(/\\/g, "/")
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^([^A-Za-z_$])/, "_$1")
    .replace(/_+$/g, "");
  return `${safe || "module"}_${hashString(modulePath)}`;
}

export function compatModuleVarName(modulePath: string): string {
  return `RTMX_COMPAT_${compatModuleKey(modulePath)}`;
}

export function compatSelectFunctionName(modulePath: string): string {
  return `RTMX_selectCompatTarget_${compatModuleKey(modulePath)}`;
}

export function targetCompatOutputPath(modulePath: string, targetName: string): string {
  const normalized = modulePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
  const baseName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const safeTarget = safeIdentifierPart(targetName);
  const uniqueSuffix = hashString(`${normalized}\0${targetName}`);
  return `${directory}${baseName}.__rtmx_${safeTarget}_${uniqueSuffix}.compat.js`;
}

function safeIdentifierPart(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^([^A-Za-z_$])/, "_$1")
    .replace(/_+$/g, "");
  return safe || "target";
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
