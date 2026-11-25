import { randomBytes } from "node:crypto";
import type { ScreenMock, ScreenStep } from "@unframed/contracts";

export interface ScreenStatePayload {
  readonly steps: ReadonlyArray<ScreenStep>;
  readonly mocks: ReadonlyArray<ScreenMock>;
}

const TOKEN_TTL_MS = 60_000;

interface Held {
  readonly payload: ScreenStatePayload;
  readonly until: number;
}

export class StateTokens {
  private readonly pages = new Map<string, Held>();
  private readonly bridges = new Map<string, Held>();

  issue(payload: ScreenStatePayload): string {
    this.sweep();
    const token = randomBytes(16).toString("hex");
    this.pages.set(token, { payload, until: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  takePage(token: string): string | undefined {
    this.sweep();
    const held = this.pages.get(token);
    if (held === undefined) return undefined;
    this.pages.delete(token);
    const key = randomBytes(16).toString("hex");
    this.bridges.set(key, { payload: held.payload, until: Date.now() + TOKEN_TTL_MS });
    return key;
  }

  takeBridge(key: string): ScreenStatePayload | undefined {
    this.sweep();
    const held = this.bridges.get(key);
    this.bridges.delete(key);
    return held?.payload;
  }

  private sweep(): void {
    const now = Date.now();
    for (const map of [this.pages, this.bridges]) for (const [key, held] of map) if (held.until < now) map.delete(key);
  }
}
