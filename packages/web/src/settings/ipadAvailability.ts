import type { IpadStatus } from "@unframed/contracts";
import { availability, licenseHosts } from "@unframed/domain";
import type { EngineConnection } from "../rpc/engine.ts";
import { tldrawLicenseKey } from "../license.ts";

export const ipadAvailable = (status: IpadStatus, key: string): boolean =>
  availability({
    platform: status.platform,
    hosted: status.hosted,
    localName: status.localName ?? undefined,
    hosts: status.testHosts ?? licenseHosts(key),
  }).available;

export const reportIpadAvailability = async (engine: EngineConnection): Promise<void> => {
  const status = await engine.call("ipad.status");
  await engine.call("ipad.setAvailability", { available: ipadAvailable(status, tldrawLicenseKey) });
};
