import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { unframedError, type AgentConnection, type ConnectionClient, type SpendLimit, type UnframedError } from "@unframed/contracts";
import { connectionNameProblem, periodStart, spendLimitProblem, spentSince, trimConnectionName, type SpendEntry } from "@unframed/domain";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";

/** A token is `ufx_` and 64 hex characters, 256 random bits. */
export const CONNECTION_TOKEN_PREFIX = "ufx_";

/** How often `lastUsedAt` is written, per connection. */
const LAST_USED_WRITE_MS = 60_000;

/** The spend log keeps this long: the longest period a limit can name is a month. */
const SPEND_LOG_DAYS = 35;

interface StoredConnection {
  readonly id: string;
  readonly name: string;
  readonly client: ConnectionClient;
  readonly tokenSha256: string;
  readonly createdAt: string;
  lastUsedAt: string | null;
  spendLimit: SpendLimit | null;
  /** Every paid run's spend over the whole life: reserved at acceptance, settled to its cost. */
  spentUsd: number;
  spendLog: LogEntry[];
}

/** One paid run's entry in the log, which settles in place. */
interface LogEntry {
  runId: string;
  at: string;
  usd: number;
  state: SpendEntry["state"];
}

export type ConnectionRecord = StoredConnection;

const REFUSAL_LOG = "agent connections: could not read agent-connections.json, so every outside connection is refused until one is made again.";

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Unreadable or malformed content refuses every token. A missing file is no connections. */
const readStore = (path: string): { connections: StoredConnection[]; refusing: boolean } => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { connections: [], refusing: false };
    return { connections: [], refusing: true };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const list = (parsed as { connections?: unknown } | null)?.connections;
    if (!Array.isArray(list)) return { connections: [], refusing: true };
    return {
      connections: (list as Array<Partial<StoredConnection> & StoredConnection>).map((connection) => ({
        ...connection,
        spendLimit: connection.spendLimit ?? null,
        spentUsd: connection.spentUsd ?? 0,
        spendLog: connection.spendLog ?? [],
      })),
      refusing: false,
    };
  } catch {
    return { connections: [], refusing: true };
  }
};

/**
 * The outside connections of one data folder. Holds only token
 * hashes; the plaintext token exists in `create`'s answer and nowhere else. It also keeps each
 * connection's spend limit and its paid runs' spend.
 */
export class ConnectionBook {
  private readonly path: string;
  private connections: StoredConnection[];
  private refusing: boolean;
  private writes: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
    const loaded = readStore(path);
    this.connections = loaded.connections;
    this.refusing = loaded.refusing;
    if (this.refusing) logError(REFUSAL_LOG);
  }

  /** Newest first. Never a token or a hash. */
  list(now: Date = new Date()): AgentConnection[] {
    return [...this.connections]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((connection) => this.view(connection, now));
  }

  /** The connection a token belongs to, or `undefined` when it is unknown, revoked or the store is unreadable. */
  resolve(token: string): ConnectionRecord | undefined {
    if (this.refusing || !token.startsWith(CONNECTION_TOKEN_PREFIX)) return undefined;
    const digest = Buffer.from(hashToken(token));
    for (const connection of this.connections) {
      const known = Buffer.from(connection.tokenSha256);
      if (known.length === digest.length && timingSafeEqual(known, digest)) return connection;
    }
    return undefined;
  }

  /** Records a call. Writes at most once a minute per connection. */
  touch(id: string, now: Date = new Date()): void {
    const connection = this.connections.find((candidate) => candidate.id === id);
    if (!connection) return;
    const last = connection.lastUsedAt === null ? undefined : Date.parse(connection.lastUsedAt);
    if (last !== undefined && now.getTime() - last < LAST_USED_WRITE_MS) return;
    connection.lastUsedAt = now.toISOString();
    void this.persist().catch((error: unknown) => logError(`could not record a call on connection ${id}: ${errorText(error)}`));
  }

  /** The limit and what the period has spent, for a paid call's check. */
  spendOf(id: string, now: Date = new Date()): { limit: SpendLimit | null; spent: number } {
    const connection = this.find(id);
    return { limit: connection.spendLimit, spent: this.spentIn(connection, now) };
  }

  async create(input: { name: string; client: ConnectionClient; spendLimit?: SpendLimit }, now: Date = new Date()): Promise<{ connection: AgentConnection; token: string }> {
    const problem = connectionNameProblem(input.name);
    if (problem !== undefined) throw unframedError("bad_request", problem);
    const limitProblem = input.spendLimit === undefined ? undefined : spendLimitProblem({ usd: input.spendLimit.usd, period: input.spendLimit.period });
    if (limitProblem !== undefined) throw unframedError("bad_request", limitProblem);
    const token = `${CONNECTION_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
    const stored: StoredConnection = {
      id: randomUUID(),
      name: trimConnectionName(input.name),
      client: input.client,
      tokenSha256: hashToken(token),
      createdAt: now.toISOString(),
      lastUsedAt: null,
      spendLimit: input.spendLimit ?? null,
      spentUsd: 0,
      spendLog: [],
    };
    const before = this.connections;
    // An unreadable file is rewritten with the new connection alone: the next create heals it.
    this.connections = this.refusing ? [stored] : [...before, stored];
    try {
      await this.persist();
    } catch (error) {
      this.connections = before;
      throw unframedError("internal", `Could not save the connection: ${errorText(error)}`);
    }
    this.refusing = false;
    return { connection: this.view(stored, now), token };
  }

  /** Sets, changes or removes (`null`) a connection's spend limit. It applies to the next call. */
  async setSpendLimit(id: string, limit: SpendLimit | null): Promise<void> {
    const connection = this.find(id);
    const problem = limit === null ? undefined : spendLimitProblem({ usd: limit.usd, period: limit.period });
    if (problem !== undefined) throw unframedError("bad_request", problem);
    const before = connection.spendLimit;
    connection.spendLimit = limit;
    try {
      await this.persist();
    } catch (error) {
      connection.spendLimit = before;
      throw unframedError("internal", `Could not save the spend limit: ${errorText(error)}`);
    }
  }

  /** Reserves a paid run's estimate on the connection, before the run starts. */
  async reserve(id: string, runId: string, usd: number, now: Date = new Date()): Promise<void> {
    const connection = this.find(id);
    connection.spendLog.push({ runId, at: now.toISOString(), usd, state: "reserved" });
    connection.spentUsd += usd;
    await this.persist().catch(() => undefined);
  }

  /** Settles a reservation to the run's cost once its output lands. */
  async settle(id: string, runId: string, usd: number): Promise<void> {
    const connection = this.find(id);
    const entry = connection.spendLog.find((candidate) => candidate.runId === runId);
    if (!entry) return;
    connection.spentUsd += usd - entry.usd;
    entry.usd = usd;
    entry.state = "landed";
    await this.persist().catch(() => undefined);
  }

  /** Drops a reservation whose run never started. */
  async release(id: string, runId: string): Promise<void> {
    const connection = this.find(id);
    const entry = connection.spendLog.find((candidate) => candidate.runId === runId);
    if (!entry) return;
    connection.spentUsd -= entry.usd;
    connection.spendLog = connection.spendLog.filter((candidate) => candidate !== entry);
    await this.persist().catch(() => undefined);
  }

  async revoke(id: string): Promise<void> {
    const found = this.connections.find((connection) => connection.id === id);
    if (!found) throw unframedError("not_found", "That connection no longer exists.");
    const before = this.connections;
    this.connections = before.filter((connection) => connection.id !== id);
    try {
      await this.persist();
    } catch (error) {
      this.connections = before;
      throw unframedError("internal", `Could not revoke the connection: ${errorText(error)}`);
    }
  }

  private find(id: string): StoredConnection {
    const found = this.connections.find((connection) => connection.id === id);
    if (!found) throw unframedError("not_found", "That connection no longer exists.");
    return found;
  }

  /** What the period has spent: the log's entries in it, or every paid run when the limit is for life. */
  private spentIn(connection: StoredConnection, now: Date): number {
    if (connection.spendLimit === null || connection.spendLimit.period === "lifetime") return connection.spentUsd;
    return spentSince(connection.spendLog, periodStart(connection.spendLimit.period, now, new Date(connection.createdAt)));
  }

  private view(connection: StoredConnection, now: Date): AgentConnection {
    return {
      id: connection.id,
      name: connection.name,
      client: connection.client,
      createdAt: connection.createdAt,
      lastUsedAt: connection.lastUsedAt,
      spendLimit: connection.spendLimit,
      spent: this.spentIn(connection, now),
    };
  }

  /** Writes the store, one write at a time, each one temp-then-rename. Log entries past the retention are dropped. */
  private persist(): Promise<void> {
    const cutoff = Date.now() - SPEND_LOG_DAYS * 24 * 60 * 60 * 1000;
    for (const connection of this.connections) {
      connection.spendLog = connection.spendLog.filter((entry) => Date.parse(entry.at) >= cutoff);
    }
    const text = `${JSON.stringify({ connections: this.connections }, null, 2)}\n`;
    const next = this.writes.then(() => writeFileAtomic(this.path, text));
    this.writes = next.catch(() => {});
    return next;
  }
}
