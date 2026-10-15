import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { unframedError, type AgentConnection, type ConnectionClient } from "@unframed/contracts";
import { connectionNameProblem, trimConnectionName } from "@unframed/domain";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";

/** Spec 14: a token is `ufx_` and 64 hex characters, 256 random bits. */
export const CONNECTION_TOKEN_PREFIX = "ufx_";

/** How often `lastUsedAt` is written, per connection. */
const LAST_USED_WRITE_MS = 60_000;

interface StoredConnection {
  readonly id: string;
  readonly name: string;
  readonly client: ConnectionClient;
  readonly tokenSha256: string;
  readonly createdAt: string;
  lastUsedAt: string | null;
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
    return { connections: list as StoredConnection[], refusing: false };
  } catch {
    return { connections: [], refusing: true };
  }
};

/**
 * The outside connections of one data folder (spec 14, "Connections and tokens"). Holds
 * only token hashes; the plaintext token exists in `create`'s answer and nowhere else.
 */
export class ConnectionBook {
  private connections: StoredConnection[];
  private refusing: boolean;
  private writes: Promise<void> = Promise.resolve();

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    const loaded = readStore(path);
    this.connections = loaded.connections;
    this.refusing = loaded.refusing;
    if (this.refusing) logError(REFUSAL_LOG);
  }

  /** Newest first. Never a token or a hash. */
  list(): AgentConnection[] {
    return [...this.connections]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map(({ id, name, client, createdAt, lastUsedAt }) => ({ id, name, client, createdAt, lastUsedAt }));
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

  async create(input: { name: string; client: ConnectionClient }, now: Date = new Date()): Promise<{ connection: AgentConnection; token: string }> {
    const problem = connectionNameProblem(input.name);
    if (problem !== undefined) throw unframedError("bad_request", problem);
    const token = `${CONNECTION_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
    const stored: StoredConnection = {
      id: randomUUID(),
      name: trimConnectionName(input.name),
      client: input.client,
      tokenSha256: hashToken(token),
      createdAt: now.toISOString(),
      lastUsedAt: null,
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
    const { tokenSha256: _hidden, ...view } = stored;
    return { connection: { ...view, lastUsedAt: null }, token };
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

  /** Writes the store, one write at a time, each one temp-then-rename. */
  private persist(): Promise<void> {
    const text = `${JSON.stringify({ connections: this.connections }, null, 2)}\n`;
    const next = this.writes.then(() => writeFileAtomic(this.path, text));
    this.writes = next.catch(() => {});
    return next;
  }
}
