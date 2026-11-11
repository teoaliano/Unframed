import { SAME_MACHINE_ONLY, type GuardDecision } from "../loopbackGuard.ts";
import { hostCovered } from "./license.ts";

export const deviceAddress = (localName: string, port: number): string => `https://${localName}:${port}`;

export type UnavailableReason = "not_macos" | "not_hosted" | "no_local_name" | "host_not_covered";

export type Availability = { readonly available: true } | { readonly available: false; readonly reason: UnavailableReason };

export const availability = (input: {
  readonly platform: string;
  readonly hosted: boolean;
  readonly localName: string | undefined;
  readonly hosts: ReadonlyArray<string>;
}): Availability => {
  if (input.platform !== "darwin") return { available: false, reason: "not_macos" };
  if (!input.hosted) return { available: false, reason: "not_hosted" };
  if (input.localName === undefined || input.localName.trim() === "") return { available: false, reason: "no_local_name" };
  if (!hostCovered(input.hosts, input.localName)) return { available: false, reason: "host_not_covered" };
  return { available: true };
};

const OCTET = /^\d{1,3}$/;

export const isPrivateAddress = (ip: string): boolean => {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 10) return true;
  if (a === 172) return b >= 16 && b <= 31;
  return a === 192 && b === 168;
};

export const deviceGuard = (input: {
  readonly host?: string | undefined;
  readonly origin?: string | undefined;
  readonly localName: string;
  readonly port: number;
}): GuardDecision => {
  const address = deviceAddress(input.localName, input.port);
  if (input.host === undefined || input.host.trim().toLowerCase() !== `${input.localName}:${input.port}`.toLowerCase()) {
    return { allowed: false, status: 403, error: `Open Unframed at ${address}.` };
  }
  if (input.origin !== undefined && input.origin.trim().toLowerCase() !== address.toLowerCase()) {
    return { allowed: false, status: 403, error: SAME_MACHINE_ONLY };
  }
  return { allowed: true };
};
