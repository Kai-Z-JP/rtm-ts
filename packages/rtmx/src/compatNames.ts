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

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
