const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const deviceNameFor = (userAgent: string, date: Date): string => {
  const kind = userAgent.includes("iPad") ? "iPad" : userAgent.includes("iPhone") ? "iPhone" : "Browser";
  return `${kind} (${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()})`;
};

const MAC_ONLY_METHODS: ReadonlySet<string> = new Set([
  "files.reveal",
  "files.path",
  "settings.pickFolder",
  "oauth.start",
  "oauth.cancel",
  "agentConnections.create",
  "agentConnections.revoke",
]);

export const MAC_ONLY_PREFERENCES: ReadonlyArray<string> = ["project.tabs", "project.active"];

export const MAC_ONLY_SETTINGS: ReadonlyArray<string> = ["ipadAccess", "ipadPort"];

export const allowedForDevice = (method: string, payload?: unknown): boolean => {
  if (MAC_ONLY_METHODS.has(method)) return false;
  if (method.startsWith("ipad.")) return method === "ipad.status";
  if (method === "settings.update") {
    const patch = (payload ?? {}) as Record<string, unknown>;
    return !MAC_ONLY_SETTINGS.some((field) => field in patch);
  }
  if (method === "preferences.set") {
    const key = (payload as { readonly key?: unknown } | undefined)?.key;
    return typeof key !== "string" || !MAC_ONLY_PREFERENCES.includes(key);
  }
  return true;
};
