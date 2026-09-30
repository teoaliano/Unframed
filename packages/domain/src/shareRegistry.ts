/**
 * The share registry's rules (spec 04): the token shape, the route a token is read from,
 * expiry, and when the tunnel is needed. The engine's share link service holds the files
 * and the tunnel; these rules hold no I/O.
 */

/** The backstop lifetime of a share link. The normal end is revocation when its job ends. */
export const SHARE_TTL_MS = 30 * 60 * 1000;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url: 43 characters. */
export const tokenFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length !== 32) throw new Error("A share token is made from exactly 32 bytes.");
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 63]!;
  }
  return out;
};

const SHARE_PATH = /^\/share\/([A-Za-z0-9_-]{43})$/;

/** The token of the share server's one route, matched against the raw request path, or `undefined`. */
export const shareTokenOf = (rawPath: string): string | undefined => SHARE_PATH.exec(rawPath)?.[1];

const MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/** The type a shared clip is served with, from its extension. */
export const shareMime = (file: string): string => MIME[/\.([^.]+)$/.exec(file)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

export interface ShareEntry<F> {
  readonly file: F;
  readonly mime: string;
  readonly expiresAt: number;
}

export interface ShareRegistry<F> {
  add(token: string, entry: { readonly file: F; readonly mime: string }, now: number): void;
  /** A registration still live at `now`. */
  get(token: string, now: number): ShareEntry<F> | undefined;
  /** Removes a registration and answers it, when there was one. */
  remove(token: string): ShareEntry<F> | undefined;
  /** The tokens past their expiry at `now`, oldest registration first. */
  expired(now: number): string[];
  /** The tunnel stays up while any registration lives. */
  tunnelNeeded(): boolean;
}

export const createShareRegistry = <F>(ttlMs: number): ShareRegistry<F> => {
  const entries = new Map<string, ShareEntry<F>>();
  return {
    add: (token, entry, now) => void entries.set(token, { ...entry, expiresAt: now + ttlMs }),
    get: (token, now) => {
      const entry = entries.get(token);
      return entry !== undefined && now < entry.expiresAt ? entry : undefined;
    },
    remove: (token) => {
      const entry = entries.get(token);
      entries.delete(token);
      return entry;
    },
    expired: (now) => [...entries].filter(([, entry]) => now >= entry.expiresAt).map(([token]) => token),
    tunnelNeeded: () => entries.size > 0,
  };
};
