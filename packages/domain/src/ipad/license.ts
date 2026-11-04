
const HOSTS_INDEX = 1;
const FLAGS_INDEX = 2;

const NATIVE_FLAG = 32;

const decodeBase64 = (value: string): string | undefined => {
  try {
    return atob(value);
  } catch {
    return undefined;
  }
};

export const licenseHosts = (key: string): ReadonlyArray<string> => {
  const cleaned = key.replace(/[​-‍﻿]/g, "").replace(/\r?\n|\r/g, "").trim();
  const [data] = cleaned.split(".");
  const [prefix, encoded] = (data ?? "").split("/");
  if (prefix === undefined || !prefix.startsWith("tldraw-") || !encoded) return [];
  const json = decodeBase64(encoded);
  if (json === undefined) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  const flags: unknown = payload[FLAGS_INDEX];
  if (typeof flags === "number" && (flags & NATIVE_FLAG) !== 0) return [];
  const hosts: unknown = payload[HOSTS_INDEX];
  return Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === "string") : [];
};

export const hostCovered = (hosts: ReadonlyArray<string>, name: string): boolean => {
  const hostname = name.toLowerCase().trim();
  if (hostname === "") return false;
  return hosts.some((host) => {
    const entry = host.toLowerCase().trim();
    if (entry === hostname || `www.${entry}` === hostname || entry === `www.${hostname}`) return true;
    if (host === "*") return true;
    if (!host.includes("*")) return false;
    const glob = new RegExp(`${entry.replace(/\./g, "\\.").replace(/\*/g, ".*?")}$`);
    return glob.test(hostname) || glob.test(`www.${hostname}`);
  });
};
