export const RESTORE_PARAM = "__unframed_restore";
export const SWITCH_PARAM = "__unframed_switch";
export const MOCKS_FOLDER = ".unframed/mocks";
export const MOCK_MODULES_FOLDER = ".unframed/mocks/modules";
export const MOCK_FILE_SUFFIX = ".mock.js";
export const MOCKS_SOURCE_PATH = "/__unframed/mocks.js";
export const MOCKS_EVENTS_PATH = "/__unframed/mocks/events";
export const MOCKS_LOG_PATH = "/__unframed/mocks/log";
export const REAL_MODULE_PARAM = "unframed_real";
export const MOCK_LOG_KEEP = 200;
export const FREEZE_ID = /^s_[0-9a-f]{32}$/;

export interface MockLogEntry {
  readonly at: number;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly mock: string | null;
  readonly site: string | null;
}

export interface FrozenField {
  readonly path: string;
  readonly value: string;
}

export interface FrozenState {
  readonly url: string;
  readonly local: Readonly<Record<string, string>>;
  readonly session: Readonly<Record<string, string>>;
  readonly collections: Readonly<Record<string, ReadonlyArray<unknown>>>;
  readonly fields: ReadonlyArray<FrozenField>;
}

export interface MockSourceFile {
  readonly name: string;
  readonly source: string;
}

export function matchPattern(pattern: string, url: string, pageOrigin: string): Readonly<Record<string, string>> | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, pageOrigin);
  } catch {
    return undefined;
  }
  const local = pattern.charAt(0) === "/";
  if (local && parsed.origin !== pageOrigin) return undefined;
  const withQuery = pattern.indexOf("?") !== -1;
  const subject = (local ? "" : parsed.origin) + parsed.pathname + (withQuery ? parsed.search : "");
  const names: string[] = [];
  let source = "";
  const token = /:([A-Za-z_][A-Za-z0-9_]*)(\*)?|\*|[^:*]+|:/g;
  let found: RegExpExecArray | null;
  while ((found = token.exec(pattern)) !== null) {
    const part = found[0];
    if (found[1] !== undefined) {
      names.push(found[1]);
      source += found[2] === "*" ? "(.*)" : "([^/?#]+)";
    } else if (part === "*") source += ".*";
    else source += part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  const matched = new RegExp(`^${source}/?$`).exec(subject);
  if (matched === null) return undefined;
  const params: Record<string, string> = {};
  names.forEach((name, at) => {
    const raw = matched[at + 1] ?? "";
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  });
  return params;
}

export function callSiteOf(stack: string): string | null {
  for (const line of stack.split("\n")) {
    const found = /(https?:\/\/[^/\s()]+)(\/[^\s()]*?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (found === null) continue;
    const path = found[2]!.split("?")[0]!.split("#")[0]!;
    if (path.indexOf("/__unframed/") === 0) continue;
    return `${path.replace(/^\/@fs\//, "/").replace(/^\//, "")}:${found[3]}:${found[4]}`;
  }
  return null;
}

export const switchesOf = (search: string, param: string): Readonly<Record<string, string>> => {
  const picked: Record<string, string> = {};
  const query = search.charAt(0) === "?" ? search.slice(1) : search;
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq) !== param) continue;
    let value = part.slice(eq + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      continue;
    }
    for (const pair of value.split(",")) {
      const colon = pair.indexOf(":");
      if (colon > 0) picked[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
    }
  }
  return picked;
};

const cutParams = (path: string, names: ReadonlyArray<string>): { readonly path: string; readonly values: Readonly<Record<string, string>> } => {
  const at = path.indexOf("?");
  if (at === -1) return { path, values: {} };
  const hash = path.indexOf("#", at);
  const query = path.slice(at + 1, hash === -1 ? undefined : hash);
  const values: Record<string, string> = {};
  const kept = query.split("&").filter((part) => {
    const eq = part.indexOf("=");
    const name = eq === -1 ? part : part.slice(0, eq);
    if (!names.includes(name)) return true;
    if (values[name] === undefined) {
      const raw = eq === -1 ? "" : part.slice(eq + 1);
      try {
        values[name] = decodeURIComponent(raw);
      } catch {
        values[name] = raw;
      }
    }
    return false;
  });
  const rest = hash === -1 ? "" : path.slice(hash);
  return { path: `${path.slice(0, at)}${kept.length === 0 ? "" : `?${kept.join("&")}`}${rest}`, values };
};

export const takeUnframedParams = (path: string): { readonly path: string; readonly restore: string | undefined } => {
  const { path: kept, values } = cutParams(path, [RESTORE_PARAM, SWITCH_PARAM]);
  const restore = values[RESTORE_PARAM];
  return { path: kept, restore: restore !== undefined && FREEZE_ID.test(restore) ? restore : undefined };
};

export const restoreRoute = (url: string, id: string): string => {
  const { path } = cutParams(url, [RESTORE_PARAM]);
  const hash = path.indexOf("#");
  const base = hash === -1 ? path : path.slice(0, hash);
  return `${base}${base.includes("?") ? "&" : "?"}${RESTORE_PARAM}=${id}${hash === -1 ? "" : path.slice(hash)}`;
};

export const withoutRestore = (route: string): string => cutParams(route, [RESTORE_PARAM]).path;

export const restoreIdOf = (route: string): string | undefined => {
  const value = cutParams(route, [RESTORE_PARAM]).values[RESTORE_PARAM];
  return value !== undefined && FREEZE_ID.test(value) ? value : undefined;
};

export const mockModulePaths = (pathname: string): ReadonlyArray<string> => {
  if (pathname.indexOf("/__unframed/") === 0 || pathname.indexOf("..") !== -1) return [];
  const trimmed = pathname.replace(/^\/+/, "");
  if (trimmed === "") return [];
  const stem = trimmed.replace(/\.(?:[cm]?[jt]sx?|vue|svelte)$/, "");
  return [...new Set([`${stem}.js`, `${stem}.mjs`, trimmed])];
};

export const isMockFileName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*\.mock\.js$/.test(name);

export const mockLogKept = (log: ReadonlyArray<MockLogEntry>, added: ReadonlyArray<MockLogEntry>): ReadonlyArray<MockLogEntry> => [...log, ...added].slice(-MOCK_LOG_KEEP);

export const mockLogEntries = (value: unknown): ReadonlyArray<MockLogEntry> => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MOCK_LOG_KEEP).flatMap((raw): MockLogEntry[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.method !== "string" || typeof entry.url !== "string") return [];
    return [
      {
        at: typeof entry.at === "number" ? entry.at : Date.now(),
        method: entry.method.slice(0, 16),
        url: entry.url.slice(0, 2000),
        status: typeof entry.status === "number" ? entry.status : null,
        mock: typeof entry.mock === "string" ? entry.mock.slice(0, 300) : null,
        site: typeof entry.site === "string" ? entry.site.slice(0, 300) : null,
      },
    ];
  });
};

export function mockRuntime(
  win: any,
  config: { readonly logPath: string; readonly eventsPath: string; readonly sourcePath: string; readonly restoreParam: string; readonly switchParam: string; readonly logKeep: number },
  match: typeof matchPattern,
  site: typeof callSiteOf,
  switchesFrom: typeof switchesOf,
): void {
  if (win.__unframedMockFiles) return;
  const restore = win.__unframedRestore;
  const origin = win.location.origin;
  const realFetch = typeof win.fetch === "function" ? win.fetch.bind(win) : undefined;
  const RealSocket = win.WebSocket;
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const storageOf = (name: string): any => {
    try {
      return win[name];
    } catch {
      return undefined;
    }
  };
  const writeStorage = (storage: any, values: any) => {
    if (!storage || !values) return;
    for (const key of Object.keys(values)) {
      try {
        if (storage.getItem(key) !== values[key]) storage.setItem(key, values[key]);
      } catch {
        continue;
      }
    }
  };
  if (restore) {
    writeStorage(storageOf("localStorage"), restore.local);
    writeStorage(storageOf("sessionStorage"), restore.session);
  }
  const picked = switchesFrom(win.location.search || "", config.switchParam);
  let handlers: any[] = [];
  let sockets: any[] = [];
  let switches: Record<string, ReadonlyArray<string>> = {};
  let loading = "";
  const collections = new Map<string, { seed: string; rows: any[] }>();
  const log: any[] = [];
  let pending: any[] = [];
  let flushTimer: any;
  const flush = () => {
    flushTimer = undefined;
    if (pending.length === 0 || !realFetch) return;
    const body = JSON.stringify(pending);
    pending = [];
    realFetch(config.logPath, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  };
  const note = (entry: any) => {
    log.push(entry);
    if (log.length > config.logKeep) log.shift();
    pending.push(entry);
    if (flushTimer === undefined) flushTimer = win.setTimeout(flush, 400);
  };
  const shortUrl = (href: string) => {
    try {
      const parsed = new win.URL(href, win.location.href);
      return parsed.origin === origin ? parsed.pathname + parsed.search : parsed.href;
    } catch {
      return href;
    }
  };
  const idOf = (row: any) => (row && row.id !== undefined ? String(row.id) : undefined);
  const collection = (name: string, rows: unknown) => {
    const seed = JSON.stringify(Array.isArray(rows) ? rows : []);
    let held = collections.get(name);
    if (held === undefined) {
      const restored = restore && restore.collections && Array.isArray(restore.collections[name]) ? restore.collections[name] : undefined;
      held = { seed, rows: clone(restored !== undefined ? restored : JSON.parse(seed)) };
      collections.set(name, held);
    } else if (held.seed !== seed) {
      held.seed = seed;
      held.rows = JSON.parse(seed);
    }
    const box = held;
    const nextId = () => {
      const numbers = box.rows.map((row) => Number(row && row.id)).filter((value) => Number.isFinite(value));
      if (numbers.length === box.rows.length) return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      return Math.random().toString(36).slice(2, 10);
    };
    return {
      all: () => clone(box.rows),
      get: (id: unknown) => clone(box.rows.find((row) => idOf(row) === String(id))),
      where: (test: any) =>
        clone(
          box.rows.filter((row) =>
            typeof test === "function" ? test(row) : Object.keys(test || {}).every((key) => row && JSON.stringify(row[key]) === JSON.stringify(test[key])),
          ),
        ),
      insert: (row: any) => {
        const added = { ...(row || {}) };
        if (added.id === undefined) added.id = nextId();
        box.rows.push(added);
        return clone(added);
      },
      update: (id: unknown, patch: any) => {
        const at = box.rows.findIndex((row) => idOf(row) === String(id));
        if (at === -1) return undefined;
        box.rows[at] = { ...box.rows[at], ...(patch || {}), id: box.rows[at].id };
        return clone(box.rows[at]);
      },
      remove: (id: unknown) => {
        const at = box.rows.findIndex((row) => idOf(row) === String(id));
        if (at === -1) return false;
        box.rows.splice(at, 1);
        return true;
      },
    };
  };
  const PASS = { __unframedPass: true };
  const FAIL = { __unframedFail: true };
  const reply: any = (answer: any) => ({ __unframedReply: true, ...(answer || {}) });
  reply.pass = () => PASS;
  reply.fail = () => FAIL;
  const define = (file: string, body: (api: any) => void) => {
    const route = (method: string) => (pattern: string, handler: any) => handlers.push({ method, pattern: String(pattern), handler, file });
    const http = { get: route("GET"), post: route("POST"), put: route("PUT"), patch: route("PATCH"), delete: route("DELETE"), any: route("*") };
    const ws = (pattern: string, handler: any) => sockets.push({ pattern: String(pattern), handler, file });
    const pick = (name: string, options: ReadonlyArray<string>) => {
      const list = Array.isArray(options) && options.length > 0 ? options.map(String) : ["on", "off"];
      switches[name] = list;
      const chosen = picked[name];
      return chosen !== undefined && list.indexOf(chosen) !== -1 ? chosen : list[0];
    };
    body({ http, ws, data: collection, switches: pick, reply });
    return file;
  };
  const load = (file: string, run: (unframed: any) => void) => {
    loading = file;
    try {
      run({ mock: (body: (api: any) => void) => define(file, body) });
    } catch (error) {
      if (win.console) win.console.error(`Unframed mock file ${file} failed:`, error);
    } finally {
      loading = "";
    }
  };
  const parseBody = (body: any) => {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    if (typeof win.URLSearchParams === "function" && body instanceof win.URLSearchParams) return Object.fromEntries(body.entries());
    if (typeof win.FormData === "function" && body instanceof win.FormData) {
      const out: Record<string, unknown> = {};
      body.forEach((value: unknown, key: string) => {
        out[key] = typeof value === "string" ? value : "[file]";
      });
      return out;
    }
    return undefined;
  };
  const handled = (method: string, href: string) => {
    const upper = String(method || "GET").toUpperCase();
    return handlers.some((entry) => (entry.method === "*" || entry.method === upper) && match(entry.pattern, href, origin) !== undefined);
  };
  const answer = async (method: string, href: string, body: any, headers: any) => {
    const upper = String(method || "GET").toUpperCase();
    for (const entry of handlers) {
      if (entry.method !== "*" && entry.method !== upper) continue;
      const params = match(entry.pattern, href, origin);
      if (params === undefined) continue;
      let url: any;
      try {
        url = new win.URL(href, win.location.href);
      } catch {
        continue;
      }
      const query: Record<string, string> = {};
      url.searchParams.forEach((value: string, key: string) => {
        query[key] = value;
      });
      const result = await entry.handler({ params, query, body: parseBody(body), method: upper, url: url.href, headers: headers || {} });
      if (result === PASS) continue;
      const label = `${entry.file}: ${entry.method === "*" ? "ANY" : entry.method} ${entry.pattern}`;
      if (result === FAIL) return { fail: true, status: 0, text: "", headers: {} as Record<string, string>, delay: 0, label };
      if (result && result.__unframedReply) {
        const status = typeof result.status === "number" ? result.status : 200;
        const raw = result.body;
        const text = raw === undefined || raw === null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
        const replyHeaders = { ...(typeof raw === "string" || raw === undefined ? {} : { "content-type": "application/json" }), ...(result.headers || {}) };
        return { status, text, headers: replyHeaders, delay: Number(result.delay) || 0, label };
      }
      if (result === undefined) return { status: 204, text: "", headers: {}, delay: 0, label };
      return { status: 200, text: JSON.stringify(result), headers: { "content-type": "application/json" }, delay: 0, label };
    }
    return undefined;
  };
  const sleep = (ms: number) => new Promise((resolve) => win.setTimeout(resolve, ms));
  if (realFetch) {
    win.fetch = function (input: any, init?: any) {
      const where = site(new Error().stack || "");
      const request = typeof win.Request === "function" && input instanceof win.Request ? input : undefined;
      const href = request ? request.url : String(input && input.href !== undefined ? input.href : input);
      const method = String((init && init.method) || (request && request.method) || "GET").toUpperCase();
      let absolute: string;
      try {
        absolute = new win.URL(href, win.location.href).href;
      } catch {
        return realFetch(input, init);
      }
      if (absolute.indexOf(`${origin}/__unframed/`) === 0) return realFetch(input, init);
      const bodyOf = init && init.body !== undefined ? Promise.resolve(init.body) : request && method !== "GET" && method !== "HEAD" ? request.clone().text() : Promise.resolve(undefined);
      return bodyOf.then((body: any) =>
        answer(method, absolute, body, init && init.headers).then((found) => {
          if (found === undefined) {
            return realFetch(input, init).then(
              (response: any) => {
                note({ at: Date.now(), method, url: shortUrl(absolute), status: response.status, mock: null, site: where });
                return response;
              },
              (error: unknown) => {
                note({ at: Date.now(), method, url: shortUrl(absolute), status: null, mock: null, site: where });
                throw error;
              },
            );
          }
          note({ at: Date.now(), method, url: shortUrl(absolute), status: found.fail ? null : found.status, mock: found.label, site: where });
          if (found.fail) throw new TypeError("Failed to fetch");
          return sleep(found.delay).then(() => {
            const empty = found.status === 204 || found.status === 205 || found.status === 304;
            return new win.Response(empty ? null : found.text, { status: found.status, headers: found.headers });
          });
        }),
      );
    };
  }
  const RealXhr = win.XMLHttpRequest;
  if (typeof RealXhr === "function") {
    const open = RealXhr.prototype.open;
    const send = RealXhr.prototype.send;
    const setHeader = RealXhr.prototype.setRequestHeader;
    RealXhr.prototype.open = function (method: string, url: string) {
      let href = String(url);
      try {
        href = new win.URL(href, win.location.href).href;
      } catch {
        href = String(url);
      }
      this.__unframedFile = { method: String(method).toUpperCase(), url: href, headers: {}, site: site(new Error().stack || "") };
      return open.apply(this, arguments as any);
    };
    RealXhr.prototype.setRequestHeader = function (name: string, value: string) {
      if (this.__unframedFile) this.__unframedFile.headers[String(name).toLowerCase()] = String(value);
      return setHeader.apply(this, arguments as any);
    };
    RealXhr.prototype.send = function (body?: any) {
      const request = this.__unframedFile;
      const xhr = this;
      const args = arguments;
      if (!request || request.url.indexOf(`${origin}/__unframed/`) === 0) return send.apply(this, args as any);
      const real = () => {
        xhr.addEventListener("loadend", () => note({ at: Date.now(), method: request.method, url: shortUrl(request.url), status: xhr.status || null, mock: null, site: request.site }));
        return send.apply(xhr, args as any);
      };
      if (!handled(request.method, request.url)) return real();
      void answer(request.method, request.url, body, request.headers).then((found) => {
        if (found === undefined) {
          real();
          return;
        }
        note({ at: Date.now(), method: request.method, url: shortUrl(request.url), status: found.fail ? null : found.status, mock: found.label, site: request.site });
        const define = (name: string, value: unknown) => Object.defineProperty(xhr, name, { configurable: true, get: () => value });
        const fire = (type: string) => xhr.dispatchEvent(new win.ProgressEvent(type));
        win.setTimeout(() => {
          if (found.fail) {
            define("readyState", 4);
            define("status", 0);
            fire("readystatechange");
            fire("error");
            fire("loadend");
            return;
          }
          let response: unknown = found.text;
          if (xhr.responseType === "json") {
            try {
              response = JSON.parse(found.text);
            } catch {
              response = null;
            }
          }
          define("status", found.status);
          define("statusText", "");
          define("responseText", found.text);
          define("response", response);
          define("responseURL", request.url);
          xhr.getAllResponseHeaders = () =>
            Object.keys(found.headers)
              .map((name) => `${name}: ${found.headers[name]}`)
              .join("\r\n");
          xhr.getResponseHeader = (name: string) => found.headers[String(name).toLowerCase()] ?? null;
          define("readyState", 4);
          fire("readystatechange");
          fire("load");
          fire("loadend");
        }, found.delay);
      });
    };
  }
  if (typeof RealSocket === "function") {
    const Fake = function (this: any, url: string, protocols?: any) {
      const href = new win.URL(String(url), win.location.href).href;
      const where = site(new Error().stack || "");
      const http = href.replace(/^ws/, "http");
      const entry = sockets.find((socket) => match(socket.pattern, http, origin) !== undefined || match(socket.pattern, href, origin) !== undefined);
      if (!entry) {
        note({ at: Date.now(), method: "WS", url: shortUrl(href), status: null, mock: null, site: where });
        return protocols === undefined ? new RealSocket(url) : new RealSocket(url, protocols);
      }
      note({ at: Date.now(), method: "WS", url: shortUrl(href), status: 101, mock: `${entry.file}: WS ${entry.pattern}`, site: where });
      const target = new win.EventTarget();
      const socket: any = target;
      const listeners: Array<(data: unknown) => void> = [];
      socket.url = href;
      socket.protocol = "";
      socket.binaryType = "blob";
      socket.bufferedAmount = 0;
      socket.extensions = "";
      socket.readyState = 0;
      const emit = (event: any) => {
        const handler = socket[`on${event.type}`];
        if (typeof handler === "function") handler.call(socket, event);
        target.dispatchEvent(event);
      };
      const close = (code?: number) => {
        if (socket.readyState >= 2) return;
        socket.readyState = 3;
        emit(new win.CloseEvent("close", { code: code || 1000, wasClean: true }));
      };
      socket.send = (data: unknown) => {
        for (const listener of listeners) win.setTimeout(() => listener(typeof data === "string" ? parseBody(data) : data), 0);
      };
      socket.close = close;
      win.setTimeout(() => {
        socket.readyState = 1;
        emit(new win.Event("open"));
        try {
          entry.handler({
            url: href,
            params: match(entry.pattern, http, origin) || match(entry.pattern, href, origin) || {},
            send: (data: unknown) => {
              if (socket.readyState === 1) emit(new win.MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) }));
            },
            close,
            onMessage: (listener: (data: unknown) => void) => listeners.push(listener),
          });
        } catch (error) {
          if (win.console) win.console.error("Unframed mock socket failed:", error);
        }
      }, 0);
      return socket;
    };
    Fake.CONNECTING = 0;
    Fake.OPEN = 1;
    Fake.CLOSING = 2;
    Fake.CLOSED = 3;
    Fake.prototype = RealSocket.prototype;
    win.WebSocket = Fake;
  }
  const cssPath = (element: any): string => {
    const parts: string[] = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== win.document.documentElement) {
      if (node.id) {
        parts.unshift(`#${win.CSS && win.CSS.escape ? win.CSS.escape(node.id) : node.id}`);
        break;
      }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      const same = parent ? Array.from(parent.children as ArrayLike<any>).filter((child: any) => child.tagName === node.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return parts.join(" > ");
  };
  const fieldsNow = () => {
    const out: Array<{ path: string; value: string }> = [];
    const all = Array.from(win.document.querySelectorAll("input, textarea") as ArrayLike<any>);
    for (const element of all) {
      const type = String(element.type || "text").toLowerCase();
      if (["password", "hidden", "file", "submit", "button", "reset", "image", "checkbox", "radio"].indexOf(type) !== -1) continue;
      if (element.value === "" && element.defaultValue === "") continue;
      out.push({ path: cssPath(element), value: String(element.value) });
    }
    return out;
  };
  const snapshotStorage = (storage: any) => {
    const out: Record<string, string> = {};
    if (!storage) return out;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null) out[key] = storage.getItem(key);
    }
    return out;
  };
  const withoutParam = (search: string) => {
    const kept = (search.charAt(0) === "?" ? search.slice(1) : search).split("&").filter((part) => part !== "" && part.split("=")[0] !== config.restoreParam);
    return kept.length === 0 ? "" : `?${kept.join("&")}`;
  };
  win.__unframedFreeze = () => {
    const rows: Record<string, unknown> = {};
    collections.forEach((held, name) => {
      rows[name] = clone(held.rows);
    });
    return {
      url: win.location.pathname + withoutParam(win.location.search || "") + (win.location.hash || ""),
      local: snapshotStorage(storageOf("localStorage")),
      session: snapshotStorage(storageOf("sessionStorage")),
      collections: rows,
      fields: fieldsNow(),
    };
  };
  if (restore && Array.isArray(restore.fields) && restore.fields.length > 0) {
    const fill = (element: any, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new win.Event("input", { bubbles: true }));
      element.dispatchEvent(new win.Event("change", { bubbles: true }));
    };
    const begun = Date.now();
    const apply = () => {
      const state = win.__unframedScreenState;
      const stepping = state && Array.isArray(state.steps) && state.steps.length > 0 && win.__unframedStateResult === undefined;
      let left = 0;
      if (!stepping) {
        for (const field of restore.fields) {
          if (field.done) continue;
          let element: any;
          try {
            element = win.document.querySelector(field.path);
          } catch {
            field.done = true;
            continue;
          }
          if (!element) {
            left++;
            continue;
          }
          fill(element, String(field.value));
          field.done = true;
        }
      } else left = 1;
      if (left === 0) {
        win.__unframedRestored = true;
        return;
      }
      if (Date.now() - begun < 20_000) win.setTimeout(apply, 100);
      else win.__unframedRestored = false;
    };
    const start = () => win.setTimeout(apply, 50);
    if (win.document.readyState === "complete") start();
    else win.addEventListener("load", start);
  } else if (restore) win.__unframedRestored = true;
  const held = () => win.__unframedScreenState !== undefined || restore !== undefined;
  let version = 0;
  const reload = () => {
    if (!held()) {
      win.location.reload();
      return;
    }
    handlers = [];
    sockets = [];
    switches = {};
    const script = win.document.createElement("script");
    const nonce = win.__unframedMockNonce;
    if (nonce) script.nonce = nonce;
    script.src = `${config.sourcePath}?v=${++version}`;
    (win.document.head || win.document.documentElement).appendChild(script);
  };
  const current = win.document.currentScript;
  if (current && current.nonce) win.__unframedMockNonce = current.nonce;
  const listen = () => {
    try {
      const events = new RealSocket(`${win.location.protocol === "https:" ? "wss:" : "ws:"}//${win.location.host}${config.eventsPath}`);
      events.onmessage = (event: any) => {
        if (event.data === "changed") reload();
      };
    } catch {
      return;
    }
  };
  if (typeof RealSocket === "function") listen();
  win.__unframedMockFiles = {
    load,
    log: () => log.slice(),
    handlers: () => handlers.map((entry) => ({ file: entry.file, method: entry.method === "*" ? "ANY" : entry.method, pattern: entry.pattern })),
    sockets: () => sockets.map((entry) => ({ file: entry.file, pattern: entry.pattern })),
    switches: () => ({ ...switches }),
    picked: () => ({ ...picked }),
    collections: () => {
      const out: Record<string, number> = {};
      collections.forEach((value, name) => {
        out[name] = value.rows.length;
      });
      return out;
    },
    loading: () => loading,
  };
}

const fileCall = (file: MockSourceFile): string => `window.__unframedMockFiles && window.__unframedMockFiles.load(${JSON.stringify(file.name)}, function (unframed) {\n${file.source}\n});`;

export const mockFilesSource = (files: ReadonlyArray<MockSourceFile>): string => files.map(fileCall).join("\n");

export const mockRuntimeSource = (files: ReadonlyArray<MockSourceFile>): string =>
  [
    `try { (${mockRuntime.toString()})(window, ${JSON.stringify({ logPath: MOCKS_LOG_PATH, eventsPath: MOCKS_EVENTS_PATH, sourcePath: MOCKS_SOURCE_PATH, restoreParam: RESTORE_PARAM, switchParam: SWITCH_PARAM, logKeep: MOCK_LOG_KEEP })}, ${matchPattern.toString()}, ${callSiteOf.toString()}, ${switchesOf.toString()}); } catch (error) { console.error("Unframed mock runtime failed:", error); }`,
    mockFilesSource(files),
    "",
  ].join("\n");

export const restorePrefix = (state: FrozenState): string => `window.__unframedRestore = ${JSON.stringify(state).replace(/</g, "\\u003c")};\n`;

export const frozenState = (value: unknown): FrozenState | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== "string" || raw.url.charAt(0) !== "/") return undefined;
  const record = (input: unknown): Record<string, string> => {
    if (typeof input !== "object" || input === null) return {};
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  };
  const collections: Record<string, ReadonlyArray<unknown>> = {};
  if (typeof raw.collections === "object" && raw.collections !== null) for (const [name, rows] of Object.entries(raw.collections as Record<string, unknown>)) if (Array.isArray(rows)) collections[name] = rows;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.flatMap((field): FrozenField[] => (typeof field === "object" && field !== null && typeof field.path === "string" && typeof field.value === "string" ? [{ path: field.path, value: field.value }] : []))
    : [];
  return { url: raw.url, local: record(raw.local), session: record(raw.session), collections, fields };
};

export interface MockFileSummary {
  readonly file: string;
  readonly handlers: ReadonlyArray<{ readonly method: string; readonly pattern: string }>;
  readonly sockets: ReadonlyArray<string>;
  readonly collections: ReadonlyArray<string>;
  readonly switches: ReadonlyArray<{ readonly name: string; readonly options: ReadonlyArray<string> }>;
}

const quoted = `(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`;
const firstOf = (found: RegExpMatchArray, from: number): string => found[from] ?? found[from + 1] ?? found[from + 2] ?? "";

export const mockFileSummary = (file: string, source: string): MockFileSummary => {
  const handlers = [...source.matchAll(new RegExp(`\\bhttp\\.(get|post|put|patch|delete|any)\\(\\s*${quoted}`, "g"))].map((found) => ({ method: found[1] === "any" ? "ANY" : found[1]!.toUpperCase(), pattern: firstOf(found, 2) }));
  const sockets = [...source.matchAll(new RegExp(`\\bws\\(\\s*${quoted}`, "g"))].map((found) => firstOf(found, 1));
  const collections = [...new Set([...source.matchAll(new RegExp(`\\bdata\\(\\s*${quoted}`, "g"))].map((found) => firstOf(found, 1)))];
  const switches = [...source.matchAll(new RegExp(`\\bswitches\\(\\s*${quoted}\\s*,\\s*\\[([^\\]]*)\\]`, "g"))].map((found) => ({
    name: firstOf(found, 1),
    options: [...found[4]!.matchAll(new RegExp(quoted, "g"))].map((option) => firstOf(option, 1)),
  }));
  return { file, handlers, sockets, collections, switches };
};
