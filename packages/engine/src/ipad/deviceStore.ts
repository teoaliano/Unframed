import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IpadDevice } from "@unframed/contracts";
import { deviceNameFor, pairingAttempt, startPairingCode, type PendingCode } from "@unframed/domain";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";

const LAST_SEEN_WRITE_MS = 60_000;

interface StoredDevice {
  readonly id: string;
  readonly name: string;
  readonly tokenSha256: string;
  readonly pairedAt: string;
  lastSeenAt: string | null;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const readStore = (path: string): { devices: StoredDevice[]; refusing: boolean } => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { devices: [], refusing: false };
    return { devices: [], refusing: true };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const list = (parsed as { devices?: unknown } | null)?.devices;
    if (!Array.isArray(list)) return { devices: [], refusing: true };
    return { devices: list as StoredDevice[], refusing: false };
  } catch {
    return { devices: [], refusing: true };
  }
};

export class DeviceStore {
  private readonly path: string;
  private devices: StoredDevice[];
  private refusing: boolean;
  private pending: PendingCode | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
    const loaded = readStore(path);
    this.devices = loaded.devices;
    this.refusing = loaded.refusing;
    if (this.refusing) logError("ipad: could not read ipad-devices.json, so every paired device is refused until one pairs again.");
  }

  startPairing(now: Date = new Date()): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending = startPairingCode(code, now.getTime());
    return { code, expiresAt: new Date(this.pending.expiresAt).toISOString() };
  }

  get pendingCode(): string | undefined {
    return this.pending?.code;
  }

  async pair(code: string, userAgent: string, now: Date = new Date()): Promise<{ ok: true; token: string; device: IpadDevice } | { ok: false; message: string }> {
    const attempt = pairingAttempt(this.pending, code, now.getTime());
    this.pending = attempt.state;
    if (!attempt.outcome.ok) return { ok: false, message: attempt.outcome.message };
    const token = randomBytes(32).toString("hex");
    const stored: StoredDevice = {
      id: randomUUID(),
      name: deviceNameFor(userAgent, now),
      tokenSha256: hashToken(token),
      pairedAt: now.toISOString(),
      lastSeenAt: null,
    };
    const before = this.devices;
    this.devices = this.refusing ? [stored] : [...before, stored];
    try {
      await this.persist();
    } catch (error) {
      this.devices = before;
      throw new Error(`Could not save the paired device: ${errorText(error)}`);
    }
    this.refusing = false;
    return { ok: true, token, device: view(stored) };
  }

  resolve(token: string): { id: string; name: string } | undefined {
    if (this.refusing || !/^[0-9a-f]{64}$/.test(token)) return undefined;
    const digest = Buffer.from(hashToken(token));
    for (const device of this.devices) {
      const known = Buffer.from(device.tokenSha256);
      if (known.length === digest.length && timingSafeEqual(known, digest)) return { id: device.id, name: device.name };
    }
    return undefined;
  }

  list(): IpadDevice[] {
    return [...this.devices].sort((a, b) => (a.pairedAt < b.pairedAt ? 1 : a.pairedAt > b.pairedAt ? -1 : 0)).map(view);
  }

  touch(id: string, now: Date = new Date()): void {
    const device = this.devices.find((candidate) => candidate.id === id);
    if (!device) return;
    const last = device.lastSeenAt === null ? undefined : Date.parse(device.lastSeenAt);
    if (last !== undefined && now.getTime() - last < LAST_SEEN_WRITE_MS) return;
    device.lastSeenAt = now.toISOString();
    void this.persist().catch((error: unknown) => logError(`could not record a call from device ${id}: ${errorText(error)}`));
  }

  async revoke(id: string): Promise<boolean> {
    const before = this.devices;
    if (!before.some((device) => device.id === id)) return false;
    this.devices = before.filter((device) => device.id !== id);
    try {
      await this.persist();
    } catch (error) {
      this.devices = before;
      throw new Error(`Could not revoke the device: ${errorText(error)}`);
    }
    return true;
  }

  private persist(): Promise<void> {
    const text = `${JSON.stringify({ devices: this.devices }, null, 2)}\n`;
    const next = this.writes.then(() => writeFileAtomic(this.path, text));
    this.writes = next.catch(() => {});
    return next;
  }
}

const view = (device: StoredDevice): IpadDevice => ({
  id: device.id,
  name: device.name,
  pairedAt: device.pairedAt,
  lastSeenAt: device.lastSeenAt,
});
