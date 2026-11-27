import { dialsBridgeSource } from "./artifacts/dials.ts";
import { editBridgeSource } from "./artifacts/editBridge.ts";
import { crossSiteCookie } from "./instanceProxy.ts";
import { inlineViewportUnits, rewriteCssUrls, snapshotPage, type SnapshotHelpers } from "./pageSnapshot.ts";
import { matchMock } from "./screenStates.ts";

export const STATE_PARAM = "__unframed_state";
export const STEP_TIMEOUT_MS = 5000;
export const QUIET_IDLE_MS = 500;
export const QUIET_CAP_MS = 15_000;

export const SNAPSHOT_SETTLE_MS = 300;
export const SNAPSHOT_GAP_MS = 800;
export const SNAPSHOT_PART_MAX_BYTES = 8 * 1024 * 1024;
export const SNAPSHOT_TOTAL_MAX_BYTES = 24 * 1024 * 1024;

export interface SnapshotConfig {
  readonly settle: number;
  readonly gap: number;
  readonly partMax: number;
  readonly totalMax: number;
}

export interface BridgeConfig {
  readonly param: string;
  readonly stepTimeout: number;
  readonly quietIdle: number;
  readonly quietCap: number;
}

export interface QuietWatch {
  readonly load: (now: number) => void;
  readonly busy: (now: number) => void;
  readonly check: (now: number) => number | undefined;
}

export function quietWatch(config: { readonly idle: number; readonly cap: number }, start: number): QuietWatch {
  let loaded = false;
  let busy = start;
  let quietAt: number | undefined;
  return {
    load: (now: number) => {
      loaded = true;
      busy = Math.max(busy, now);
    },
    busy: (now: number) => {
      busy = Math.max(busy, now);
    },
    check: (now: number) => {
      if (quietAt === undefined && ((loaded && now - busy >= config.idle) || now - start >= config.cap)) quietAt = now;
      return quietAt;
    },
  };
}

export function stepExpired(started: number, quietAt: number | undefined, now: number, timeout: number): boolean {
  return quietAt !== undefined && now > Math.max(started, quietAt) + timeout;
}

export function cutParam(query: string, param: string): { readonly query: string; readonly value: string | undefined } {
  let value: string | undefined;
  const kept: string[] = [];
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if ((eq === -1 ? part : part.slice(0, eq)) !== param) {
      kept.push(part);
      continue;
    }
    if (value !== undefined) continue;
    const raw = eq === -1 ? "" : part.slice(eq + 1);
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
  }
  return { query: kept.join("&"), value };
}

export function screenBridge(
  win: any,
  config: BridgeConfig,
  match: (mocks: ReadonlyArray<any>, request: { method: string; url: string }) => any,
  cut: (query: string, param: string) => { readonly query: string; readonly value: string | undefined },
  quiet: typeof quietWatch,
  expired: typeof stepExpired,
): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const state = win.__unframedScreenState;
  const steps: any[] = state && Array.isArray(state.steps) ? state.steps : [];
  const mocks: any[] = state && Array.isArray(state.mocks) ? state.mocks : [];
  win.__unframedScreenBridge = true;
  const sleep = (ms: number) => new Promise((resolve) => win.setTimeout(resolve, ms));
  const settle = quiet({ idle: config.quietIdle, cap: config.quietCap }, Date.now());
  if (win.document.readyState === "complete") settle.load(Date.now());
  else win.addEventListener("load", () => settle.load(Date.now()));
  if (typeof win.PerformanceObserver === "function") {
    for (const type of ["resource", "longtask"]) {
      try {
        new win.PerformanceObserver(() => settle.busy(Date.now())).observe({ type });
      } catch {
        continue;
      }
    }
  }

  const routeOf = () => {
    const location = win.location;
    if (typeof location.pathname !== "string") return undefined;
    return location.pathname + (location.search || "") + (location.hash || "");
  };

  const search = typeof win.location.search === "string" ? win.location.search : "";
  if (win.history && search.length > 1) {
    const stripped = cut(search.slice(1), config.param);
    if (stripped.value !== undefined) win.history.replaceState(win.history.state, "", win.location.pathname + (stripped.query === "" ? "" : `?${stripped.query}`) + (win.location.hash || ""));
  }

  if (mocks.length > 0) {
    const find = (method: string, url: string) => {
      try {
        return match(mocks, { method: method || "GET", url: new win.URL(url, win.location.href).href });
      } catch {
        return undefined;
      }
    };
    const headersOf = (mock: any): Record<string, string> => mock.headers || {};
    const bodyOf = (mock: any): string => (typeof mock.body === "string" ? mock.body : "");
    const realFetch = win.fetch;
    if (typeof realFetch === "function") {
      win.fetch = function (input: any, init?: any) {
        const request = typeof win.Request === "function" && input instanceof win.Request ? input : undefined;
        const url = request ? request.url : String(input && input.href !== undefined ? input.href : input);
        const method = (init && init.method) || (request && request.method) || "GET";
        const mock = find(method, url);
        if (!mock) return realFetch.apply(this, arguments as any);
        return sleep(mock.delay || 0).then(() => {
          if (mock.fail) throw new TypeError("Failed to fetch");
          const status = mock.status || 200;
          const empty = status === 204 || status === 205 || status === 304;
          return new win.Response(empty ? null : bodyOf(mock), { status, headers: headersOf(mock) });
        });
      };
    }
    const RealXhr = win.XMLHttpRequest;
    if (typeof RealXhr === "function") {
      const open = RealXhr.prototype.open;
      const send = RealXhr.prototype.send;
      RealXhr.prototype.open = function (method: string, url: string) {
        this.__unframedRequest = { method: String(method), url: String(url) };
        return open.apply(this, arguments as any);
      };
      RealXhr.prototype.send = function () {
        const request = this.__unframedRequest;
        const mock = request ? find(request.method, request.url) : undefined;
        if (!mock) return send.apply(this, arguments as any);
        const xhr = this;
        const define = (name: string, value: unknown) => Object.defineProperty(xhr, name, { configurable: true, get: () => value });
        const fire = (type: string) => xhr.dispatchEvent(new win.ProgressEvent(type));
        win.setTimeout(() => {
          if (mock.fail) {
            define("readyState", 4);
            define("status", 0);
            fire("readystatechange");
            fire("error");
            fire("loadend");
            return;
          }
          const headers = headersOf(mock);
          const text = bodyOf(mock);
          let response: unknown = text;
          if (xhr.responseType === "json") {
            try {
              response = JSON.parse(text);
            } catch {
              response = null;
            }
          }
          define("status", mock.status || 200);
          define("statusText", "");
          define("responseText", text);
          define("response", response);
          define("responseURL", new win.URL(request.url, win.location.href).href);
          xhr.getAllResponseHeaders = () =>
            Object.keys(headers)
              .map((name) => `${name}: ${headers[name]}`)
              .join("\r\n");
          xhr.getResponseHeader = (name: string) => headers[String(name).toLowerCase()] ?? null;
          define("readyState", 4);
          fire("readystatechange");
          fire("load");
          fire("loadend");
        }, mock.delay || 0);
      };
    }
    const RealEventSource = win.EventSource;
    if (typeof RealEventSource === "function") {
      const Fake = function (this: any, url: string, options?: any) {
        const mock = find("GET", String(url));
        if (!mock) return new RealEventSource(url, options);
        const target = new win.EventTarget();
        const source: any = target;
        source.url = new win.URL(String(url), win.location.href).href;
        source.withCredentials = false;
        source.readyState = 0;
        source.close = () => {
          source.readyState = 2;
        };
        const emit = (event: any) => {
          if (source.readyState === 2) return;
          const handler = source[`on${event.type}`];
          if (typeof handler === "function") handler.call(source, event);
          target.dispatchEvent(event);
        };
        win.setTimeout(() => {
          if (mock.fail) {
            source.readyState = 2;
            emit(new win.Event("error"));
            return;
          }
          source.readyState = 1;
          emit(new win.Event("open"));
          for (const block of bodyOf(mock).split(/\r?\n\r?\n/)) {
            const data: string[] = [];
            let type = "message";
            for (const line of block.split(/\r?\n/)) {
              if (line.indexOf("data:") === 0) data.push(line.slice(5).replace(/^ /, ""));
              else if (line.indexOf("event:") === 0) type = line.slice(6).trim();
            }
            if (data.length > 0) emit(new win.MessageEvent(type, { data: data.join("\n") }));
          }
        }, mock.delay || 0);
        return source;
      };
      win.EventSource = Fake;
    }
  }

  let parent: string | undefined;
  if ((win.parent as unknown) !== win) {
    const ancestors = win.location.ancestorOrigins;
    parent = ancestors !== undefined && ancestors.length > 0 ? ancestors[0] : undefined;
    if (parent === undefined && win.document.referrer !== "") {
      try {
        parent = new URL(win.document.referrer).origin;
      } catch {
        parent = undefined;
      }
    }
    if (parent !== undefined && !LOOPBACK.test(parent)) parent = undefined;
  }
  if (parent !== undefined) win.unframedEditPeer = parent;
  const tell = (type: string, extra?: Record<string, unknown>) => {
    if (parent === undefined) return;
    try {
      win.parent.postMessage({ type, href: win.location.href, ...extra }, parent);
    } catch {
      return;
    }
  };

  let replaying = false;
  let reported = routeOf();
  const report = () => {
    const route = routeOf();
    if (route === undefined || route === reported) return;
    reported = route;
    tell("unframed:screen:route", { route, replaying });
  };
  if (win.history) {
    for (const name of ["pushState", "replaceState"]) {
      const original = win.history[name];
      if (typeof original !== "function") continue;
      win.history[name] = function () {
        const result = original.apply(this, arguments as any);
        report();
        return result;
      };
    }
    win.addEventListener("popstate", report);
    win.addEventListener("hashchange", report);
  }

  const normal = (value: unknown) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const visible = (element: any) => {
    if (typeof element.getClientRects !== "function" || element.getClientRects().length === 0) return false;
    const style = win.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const ROLES: Record<string, string> = {
    button: "button,[role=button],input[type=button],input[type=submit],input[type=reset],summary",
    link: "a[href],[role=link]",
    textbox:
      "input:not([type]),input[type=text],input[type=email],input[type=search],input[type=url],input[type=tel],input[type=password],input[type=number],textarea,[role=textbox],[role=searchbox],[contenteditable=''],[contenteditable=true]",
    searchbox: "input[type=search],[role=searchbox]",
    checkbox: "input[type=checkbox],[role=checkbox]",
    radio: "input[type=radio],[role=radio]",
    combobox: "select,[role=combobox]",
    heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
    menuitem: "[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]",
    option: "option,[role=option]",
    dialog: "dialog,[role=dialog],[role=alertdialog]",
    listitem: "li,[role=listitem]",
    list: "ul,ol,[role=list]",
    img: "img,[role=img]",
    navigation: "nav,[role=navigation]",
    slider: "input[type=range],[role=slider]",
    row: "tr,[role=row]",
    cell: "td,[role=cell],[role=gridcell]",
    table: "table,[role=table]",
  };
  const textOf = (element: any) => normal(element.innerText !== undefined ? element.innerText : element.textContent);
  const nameOf = (element: any) => {
    const label = element.getAttribute("aria-label");
    if (label) return normal(label);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return normal(
        labelledBy
          .split(/\s+/)
          .map((id: string) => win.document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
    }
    if (element.labels && element.labels.length > 0) return normal(Array.from(element.labels as ArrayLike<any>, (item: any) => item.textContent).join(" "));
    if (element.tagName === "IMG") return normal(element.getAttribute("alt"));
    if (element.tagName === "INPUT" && /^(button|submit|reset)$/i.test(element.type)) return normal(element.value);
    const text = textOf(element);
    if (text !== "") return text;
    return normal(element.getAttribute("title") || element.getAttribute("placeholder"));
  };
  const candidates = (target: any): any[] => {
    const all = (selector: string) => Array.from(win.document.querySelectorAll(selector) as ArrayLike<any>).filter(visible);
    if (target.role) {
      const role = String(target.role).toLowerCase();
      const found = all(ROLES[role] ? `${ROLES[role]},[role=${role}]` : `[role=${role}]`);
      if (!target.name) return found;
      const wanted = normal(target.name);
      const exact = found.filter((element) => nameOf(element) === wanted);
      return exact.length > 0 ? exact : found.filter((element) => nameOf(element).indexOf(wanted) !== -1);
    }
    if (target.text) {
      const wanted = normal(target.text);
      const deepest = (keep: (element: any) => boolean) => {
        const found = all("body *").filter(keep);
        return found.filter((element) => !found.some((other) => other !== element && element.contains(other)));
      };
      const exact = deepest((element) => textOf(element) === wanted);
      return exact.length > 0 ? exact : deepest((element) => textOf(element).indexOf(wanted) !== -1);
    }
    return all(target.selector);
  };
  const describe = (target: any) => (target.role ? (target.name ? `${target.role} ${target.name}` : target.role) : target.text ? `"${target.text}"` : target.selector);
  const locate = async (target: any) => {
    const begun = Date.now();
    for (;;) {
      let found: any[];
      try {
        found = candidates(target);
      } catch {
        throw new Error(`${describe(target)} is not a valid target`);
      }
      if (found.length > 0) return found[0];
      const now = Date.now();
      if (expired(begun, settle.check(now), now, config.stepTimeout)) throw new Error(`nothing matched ${describe(target)} within ${Math.round(config.stepTimeout / 1000)} seconds of the page going quiet`);
      await sleep(50);
    }
  };
  const mouse = (element: any, types: string[]) => {
    const box = element.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: win, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
    for (const type of types) element.dispatchEvent(type.indexOf("pointer") === 0 && typeof win.PointerEvent === "function" ? new win.PointerEvent(type, at) : new win.MouseEvent(type, at));
  };
  const keys = (element: any, key: string) => {
    const init = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, composed: true };
    const down = element.dispatchEvent(new win.KeyboardEvent("keydown", init));
    if (key.length === 1 || key === "Enter") element.dispatchEvent(new win.KeyboardEvent("keypress", init));
    element.dispatchEvent(new win.KeyboardEvent("keyup", init));
    if (down && key === "Enter" && element.form && typeof element.form.requestSubmit === "function" && element.tagName === "INPUT") element.form.requestSubmit();
  };
  let pressed: any;
  const focusOn = (element: any) => {
    pressed = element;
    if (win.document.hasFocus() && typeof element.focus === "function") element.focus();
  };
  const fill = (element: any, text: string) => {
    focusOn(element);
    if (element.isContentEditable) element.textContent = text;
    else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    }
    element.dispatchEvent(new win.Event("input", { bubbles: true }));
    element.dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const perform = async (step: any) => {
    if (step.action === "press") {
      const element = step.target ? await locate(step.target) : (win.document.hasFocus() ? win.document.activeElement : pressed) || win.document.activeElement || win.document.body;
      keys(element, String(step.key));
      return;
    }
    const element = await locate(step.target);
    if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "center" });
    if (step.action === "click") {
      mouse(element, ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown"]);
      focusOn(element);
      mouse(element, ["pointerup", "mouseup"]);
      element.click();
    } else if (step.action === "hover") mouse(element, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]);
    else if (step.action === "type") fill(element, String(step.text ?? ""));
  };
  const replay = async () => {
    replaying = true;
    try {
      for (let index = 0; index < steps.length; index++) {
        try {
          await perform(steps[index]);
        } catch (error) {
          return { ok: false, step: index, reason: error instanceof Error ? error.message : String(error) };
        }
        await sleep(120);
      }
      return { ok: true };
    } finally {
      replaying = false;
      reported = routeOf();
    }
  };

  tell("unframed:screen:ready", { route: routeOf(), state: state !== undefined });
  const painted = () =>
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        tell("unframed:screen:paint");
        if (state === undefined) return;
        void (steps.length === 0 ? Promise.resolve({ ok: true }) : replay()).then((result) => {
          win.__unframedStateResult = result;
          tell("unframed:screen:steps", result);
        });
      }),
    );
  if (win.document.readyState === "loading") win.addEventListener("DOMContentLoaded", painted);
  else painted();
}

export function snapshotBridge(win: any, config: SnapshotConfig, snapshot: typeof snapshotPage, helpers: SnapshotHelpers): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const load = typeof win.fetch === "function" ? win.fetch.bind(win) : undefined;
  const fetched = new Map<string, Promise<{ type: string; data: string | null; size: number }>>();
  const encode = (blob: any): Promise<string | null> =>
    new Promise((resolve) => {
      const reader = new win.FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        resolve(text.slice(text.indexOf(",") + 1));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  const fetchPart = (url: string) => {
    const known = fetched.get(url);
    if (known !== undefined) return known;
    const pending = (async () => {
      try {
        if (load === undefined) throw new Error("no fetch");
        const response = await load(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const type = blob.type || response.headers.get("content-type") || "";
        if (blob.size > config.partMax) return { type, data: null, size: blob.size };
        const data = await encode(blob);
        if (data === null) throw new Error("unreadable");
        return { type, data, size: blob.size };
      } catch {
        fetched.delete(url);
        return { type: "", data: null, size: 0 };
      }
    })();
    fetched.set(url, pending);
    return pending;
  };
  win.__unframedSnapshot = async () => {
    const page = snapshot(win, helpers);
    const loaded = await Promise.all(page.parts.map(fetchPart));
    let total = 0;
    let over = false;
    const parts = page.parts.map((url, index) => {
      const found = loaded[index]!;
      let data = found.data;
      if (data !== null) {
        if (over || total + found.size > config.totalMax) {
          over = true;
          data = null;
        } else total += found.size;
      }
      return { url, type: found.type, data };
    });
    return { html: page.html, w: page.w, h: page.h, parts };
  };

  let peer: string | undefined;
  let watching = false;
  let observer: any;
  let timer: any;
  let changedAt = 0;
  let capturedAt = -Infinity;
  let busy = false;
  let again = false;
  let posted: string | undefined;
  const post = (message: Record<string, unknown>) => {
    if (peer === undefined) return;
    try {
      win.parent.postMessage({ type: "unframed:snapshot", href: win.location.href, ...message }, peer);
    } catch {
      return;
    }
  };
  const capture = async (final: boolean) => {
    busy = true;
    capturedAt = Date.now();
    try {
      const taken = await win.__unframedSnapshot();
      if (final || taken.html !== posted) {
        posted = taken.html;
        post({ final, snapshot: taken });
      }
    } catch (error) {
      if (final) post({ final, snapshot: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
      if (again && watching) {
        again = false;
        changed();
      }
    }
  };
  const fire = () => {
    timer = undefined;
    if (!watching) return;
    const now = Date.now();
    const wait = Math.max(changedAt + config.settle - now, capturedAt + config.gap - now);
    if (wait > 0) {
      timer = win.setTimeout(fire, wait);
      return;
    }
    if (busy) {
      again = true;
      return;
    }
    void capture(false);
  };
  const changed = () => {
    if (!watching) return;
    changedAt = Date.now();
    if (timer === undefined) timer = win.setTimeout(fire, config.settle);
  };
  const watch = (on: boolean) => {
    if (on === watching) return;
    watching = on;
    if (on) {
      if (typeof win.MutationObserver === "function") {
        observer = new win.MutationObserver(changed);
        observer.observe(win.document, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      win.addEventListener("scroll", changed, true);
      win.addEventListener("input", changed, true);
      changed();
      return;
    }
    observer?.disconnect();
    observer = undefined;
    win.removeEventListener("scroll", changed, true);
    win.removeEventListener("input", changed, true);
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    again = false;
  };
  win.addEventListener("message", (event: any) => {
    if (win.parent === win || event.source !== win.parent) return;
    if (typeof event.origin !== "string" || !LOOPBACK.test(event.origin)) return;
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.type === "unframed:snapshot:watch") {
      peer = event.origin;
      watch(data.on === true);
    } else if (data.type === "unframed:snapshot:take") {
      peer = event.origin;
      void capture(true);
    }
  });
}

export function readableCanvases(win: any): void {
  if (win.parent === win && win.navigator?.webdriver !== true) return;
  const WEBGL = /^(webgl2?|experimental-webgl)$/;
  for (const name of ["HTMLCanvasElement", "OffscreenCanvas"]) {
    const proto = win[name]?.prototype;
    const native = proto?.getContext;
    if (typeof native !== "function") continue;
    proto.getContext = function (this: unknown, type: unknown, options?: unknown) {
      if (typeof type !== "string" || !WEBGL.test(type)) return native.apply(this, arguments as any);
      const given = options !== null && typeof options === "object" ? options : {};
      return native.call(this, type, { ...given, preserveDrawingBuffer: true });
    };
  }
}

const patchDocumentCookie = (win: any, rewrite: (cookie: string) => string): void => {
  const proto = win.Document?.prototype;
  const native = proto === undefined ? undefined : Object.getOwnPropertyDescriptor(proto, "cookie");
  if (native?.get === undefined || native.set === undefined) return;
  const write = native.set;
  Object.defineProperty(proto, "cookie", {
    ...native,
    set(value: unknown) {
      write.call(this, rewrite(String(value)));
    },
  });
};

export const screenBridgeSource = (): string =>
  [
    `(${readableCanvases.toString()})(window);`,
    `(${patchDocumentCookie.toString()})(window, ${crossSiteCookie.toString()});`,
    ...dialsBridgeSource().split("\n").slice(1, -1),
    `(${snapshotBridge.toString()})(window, ${JSON.stringify({ settle: SNAPSHOT_SETTLE_MS, gap: SNAPSHOT_GAP_MS, partMax: SNAPSHOT_PART_MAX_BYTES, totalMax: SNAPSHOT_TOTAL_MAX_BYTES } satisfies SnapshotConfig)}, ${snapshotPage.toString()}, { units: ${inlineViewportUnits.toString()}, urls: ${rewriteCssUrls.toString()} });`,
    `(${screenBridge.toString()})(window, ${JSON.stringify({ param: STATE_PARAM, stepTimeout: STEP_TIMEOUT_MS, quietIdle: QUIET_IDLE_MS, quietCap: QUIET_CAP_MS } satisfies BridgeConfig)}, ${matchMock.toString()}, ${cutParam.toString()}, ${quietWatch.toString()}, ${stepExpired.toString()});`,
    ...editBridgeSource({ stamp: true }).split("\n").slice(1, -1),
    "",
  ].join("\n");

export const stateRoute = (route: string, token: string): string => {
  const hash = route.indexOf("#");
  const path = hash === -1 ? route : route.slice(0, hash);
  const rest = hash === -1 ? "" : route.slice(hash);
  return `${path}${path.includes("?") ? "&" : "?"}${STATE_PARAM}=${encodeURIComponent(token)}${rest}`;
};

export const takeStateParam = (path: string): { readonly path: string; readonly token: string | undefined } => {
  const query = path.indexOf("?");
  if (query === -1) return { path, token: undefined };
  const { query: rest, value: token } = cutParam(path.slice(query + 1), STATE_PARAM);
  if (token === undefined) return { path, token };
  return { path: rest === "" ? path.slice(0, query) : `${path.slice(0, query)}?${rest}`, token };
};
