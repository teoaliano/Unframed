export interface StackFrame {
  readonly fn: string;
  readonly url: string;
  readonly line: number;
  readonly col: number;
}

export interface RawSource {
  readonly file?: string;
  readonly url?: string;
  readonly line: number;
  readonly col: number;
}

export interface MappedPosition {
  readonly source: number;
  readonly line: number;
  readonly col: number;
}

export function stackFrames(stack: string): StackFrame[] {
  const found: StackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    const chrome = /^at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (chrome !== null) {
      found.push({ fn: chrome[1] ?? "", url: chrome[2]!, line: Number(chrome[3]), col: Number(chrome[4]) });
      continue;
    }
    const other = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (other !== null) found.push({ fn: other[1] ?? "", url: other[2]!, line: Number(other[3]), col: Number(other[4]) });
  }
  return found;
}

export function callsiteFrame(frames: ReadonlyArray<StackFrame>): StackFrame | undefined {
  const RUNTIME_FN = /(^|[.\s])(jsxDEV|jsxs|jsx|createElement|jsxWithValidation\w*|jsxDEVImpl|react[_-]stack[_-]bottom[_-]frame)$/;
  const RUNTIME_URL = /\/node_modules\/|\/\.vite\/deps\/|react-jsx-dev-runtime|react-jsx-runtime|react-dom|\/@react-refresh/;
  for (const frame of frames) {
    if (RUNTIME_FN.test(frame.fn) || RUNTIME_URL.test(frame.url)) continue;
    if (!/^(https?:|file:|webpack-internal:|webpack:)/.test(frame.url)) continue;
    return frame;
  }
  return undefined;
}

export function decodeMappings(mappings: string): number[][][] {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lines: number[][][] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceCol = 0;
  let name = 0;
  for (const text of mappings.split(";")) {
    const segments: number[][] = [];
    let column = 0;
    for (const part of text.split(",")) {
      if (part === "") continue;
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (let index = 0; index < part.length; index++) {
        const digit = CHARS.indexOf(part.charAt(index));
        value += (digit & 31) << shift;
        if ((digit & 32) !== 0) {
          shift += 5;
          continue;
        }
        const negative = (value & 1) === 1;
        value >>>= 1;
        values.push(negative ? -value : value);
        value = 0;
        shift = 0;
      }
      column += values[0] ?? 0;
      const segment = [column];
      if (values.length >= 4) {
        source += values[1]!;
        sourceLine += values[2]!;
        sourceCol += values[3]!;
        segment.push(source, sourceLine, sourceCol);
        if (values.length >= 5) {
          name += values[4]!;
          segment.push(name);
        }
      }
      segments.push(segment);
    }
    lines.push(segments);
  }
  return lines;
}

export function originalPosition(decoded: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>, line: number, col: number): MappedPosition | undefined {
  const segments = decoded[line - 1];
  if (segments === undefined) return undefined;
  let best: ReadonlyArray<number> | undefined;
  for (const segment of segments) {
    if (segment.length < 4) continue;
    if (segment[0]! <= col - 1) best = segment;
    else if (best === undefined) best = segment;
    else break;
  }
  return best === undefined ? undefined : { source: best[1]!, line: best[2]! + 1, col: best[3]! + 1 };
}

export function sourceKey(raw: RawSource): string {
  const where = raw.file ?? (raw.url ?? "").replace(/[?#].*$/, "");
  return where + ":" + raw.line + ":" + raw.col;
}

export interface SourceTools {
  readonly frames: typeof stackFrames;
  readonly callsite: typeof callsiteFrame;
  readonly decode: typeof decodeMappings;
  readonly original: typeof originalPosition;
  readonly key: typeof sourceKey;
}

export function installSourceModule(win: any, tools: SourceTools): void {
  if (win.__unframedSource) return;
  const HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
  const HOST = [5, 26, 27];
  const COMPOSITE = [0, 1, 2, 11, 14, 15];
  const SHELL = 0.9;
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const doc = win.document;
  let commits = 0;
  let commitTimer: unknown = null;
  const post = (message: Record<string, unknown>) => {
    const peer = win.unframedEditPeer;
    if (typeof peer !== "string") return;
    try {
      win.parent.postMessage(message, peer);
    } catch {
      return;
    }
  };
  const committed = () => {
    commits += 1;
    if (commitTimer !== null) return;
    commitTimer = win.setTimeout(() => {
      commitTimer = null;
      post({ type: "unframed:source:commit", commits });
    }, 50);
  };

  let existing: any;
  try {
    existing = win[HOOK];
  } catch {
    existing = undefined;
  }
  if (existing !== null && typeof existing === "object") {
    const original = existing.onCommitFiberRoot;
    try {
      existing.onCommitFiberRoot = function () {
        committed();
        if (typeof original === "function") return original.apply(this, arguments as any);
        return undefined;
      };
    } catch {
      existing = undefined;
    }
  } else {
    let next = 0;
    const renderers = new Map();
    try {
      win[HOOK] = {
        renderers,
        supportsFiber: true,
        isDisabled: false,
        inject(renderer: unknown) {
          next += 1;
          renderers.set(next, renderer);
          return next;
        },
        onScheduleFiberRoot() {},
        onCommitFiberRoot() {
          committed();
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      };
    } catch {
      return;
    }
  }

  const fiberOf = (el: any): any => {
    if (el === null || typeof el !== "object") return null;
    for (const name of Object.keys(el)) if (name.indexOf("__reactFiber$") === 0 || name.indexOf("__reactInternalInstance$") === 0) return el[name];
    return null;
  };
  const nameOfType = (type: any): string | null => {
    if (type === null || type === undefined) return null;
    if (typeof type === "function") return type.displayName || type.name || null;
    if (typeof type === "object") {
      if (typeof type.displayName === "string" && type.displayName !== "") return type.displayName;
      if (type.render) return nameOfType(type.render);
      if (type.type) return nameOfType(type.type);
    }
    return null;
  };
  const stacks = new WeakMap<object, RawSource | null>();
  const rawOfFiber = (fiber: any): RawSource | null => {
    if (fiber === null || fiber === undefined) return null;
    const own = fiber._debugSource;
    if (own && typeof own.fileName === "string") return { file: own.fileName, line: Number(own.lineNumber) || 0, col: Number(own.columnNumber) || 0 };
    const error = fiber._debugStack;
    if (error === null || typeof error !== "object") return null;
    if (stacks.has(error)) return stacks.get(error) ?? null;
    const frame = typeof error.stack === "string" ? tools.callsite(tools.frames(error.stack)) : undefined;
    const raw = frame === undefined ? null : { url: frame.url, line: frame.line, col: frame.col };
    stacks.set(error, raw);
    return raw;
  };
  const ownRaw = (el: any): RawSource | null => {
    const fiber = fiberOf(el);
    return fiber !== null && HOST.indexOf(fiber.tag) !== -1 ? rawOfFiber(fiber) : null;
  };
  const firstHost = (fiber: any): any => {
    let node = fiber.child;
    while (node) {
      if (HOST.indexOf(node.tag) !== -1 && node.stateNode && node.stateNode.nodeType === 1) return node.stateNode;
      if (node.child) {
        node = node.child;
        continue;
      }
      while (!node.sibling) {
        node = node.return;
        if (!node || node === fiber) return null;
      }
      node = node.sibling;
    }
    return null;
  };
  const ownerOf = (el: any): string | null => {
    const fiber = fiberOf(el);
    if (fiber === null) return null;
    if (fiber._debugOwner) return nameOfType(fiber._debugOwner.type) ?? (typeof fiber._debugOwner.name === "string" ? fiber._debugOwner.name : null);
    for (let up = fiber.return; up; up = up.return) if (COMPOSITE.indexOf(up.tag) !== -1) return nameOfType(up.type);
    return null;
  };
  const rootedHere = (el: any): any => {
    const fiber = fiberOf(el);
    let found: any = null;
    if (fiber === null) return null;
    for (let up = fiber.return; up; up = up.return) {
      if (HOST.indexOf(up.tag) !== -1) break;
      if (COMPOSITE.indexOf(up.tag) !== -1 && firstHost(up) === el) found = up;
    }
    return found;
  };
  const shown = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "ƒ";
    if (Array.isArray(value)) return "[…]";
    return "{…}";
  };
  const propsOf = (fiber: any): Record<string, unknown> | null => {
    const props = fiber && fiber.memoizedProps;
    if (props === null || typeof props !== "object") return null;
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(props)) if (name !== "children") out[name] = shown(props[name]);
    return out;
  };
  const covers = (el: any): boolean => {
    if (typeof el.getBoundingClientRect !== "function") return false;
    const box = el.getBoundingClientRect();
    const width = win.innerWidth || 0;
    const height = win.innerHeight || 0;
    return width > 0 && height > 0 && box.width >= width * SHELL && box.height >= height * SHELL;
  };

  const levels = (el: any): Array<{ el: any; component: string | null }> => {
    const fiber = fiberOf(el);
    if (fiber === null) return [{ el, component: null }];
    const inner: Array<{ el: any; component: string | null }> = [];
    for (let up = fiber.return; up; up = up.return) {
      if (COMPOSITE.indexOf(up.tag) === -1) continue;
      const host = firstHost(up);
      if (!host || (host !== el && !(typeof host.contains === "function" && host.contains(el)))) continue;
      inner.push({ el: host, component: nameOfType(up.type) });
    }
    const out: Array<{ el: any; component: string | null }> = [];
    for (let index = inner.length - 1; index >= 0; index--) {
      const level = inner[index]!;
      if (out.some((each) => each.el === level.el)) continue;
      if (level.el !== el && covers(level.el)) continue;
      out.push(level);
    }
    if (out.length === 0 || out[out.length - 1]!.el !== el) out.push({ el, component: null });
    return out;
  };

  const mappedAncestor = (el: any): { el: any; raw: RawSource } | null => {
    for (let up = el; up && up.nodeType === 1; up = up.parentElement) {
      const raw = ownRaw(up);
      if (raw !== null) return { el: up, raw };
    }
    return null;
  };
  const sameSite = (key: string): any[] => {
    const found: any[] = [];
    const all = typeof doc.querySelectorAll === "function" ? doc.querySelectorAll("*") : [];
    for (const each of Array.from(all as ArrayLike<any>)) {
      const raw = ownRaw(each);
      if (raw !== null && tools.key(raw) === key) found.push(each);
    }
    return found;
  };

  const describe = (el: any) => {
    const anchor = mappedAncestor(el);
    if (anchor === null) return null;
    const key = tools.key(anchor.raw);
    const twins = sameSite(key);
    const rooted = rootedHere(anchor.el);
    return {
      raw: anchor.raw,
      key,
      selfMapped: anchor.el === el,
      tag: String(anchor.el.tagName || "").toLowerCase(),
      owner: ownerOf(anchor.el),
      instanceOf: rooted === null ? null : nameOfType(rooted.type),
      props: rooted === null ? null : propsOf(rooted),
      instanceIndex: Math.max(0, twins.indexOf(anchor.el)),
      instanceCount: Math.max(1, twins.length),
    };
  };

  const maps = new Map<string, Promise<any>>();
  const fetchText = (url: string): Promise<string> => win.fetch(url, { credentials: "same-origin" }).then((response: any) => (response.ok ? response.text() : ""));
  const mapOf = (url: string): Promise<any> => {
    const bare = url.replace(/#.*$/, "");
    let found = maps.get(bare);
    if (found === undefined) {
      found = fetchText(bare)
        .then((text) => {
          const MAP_COMMENT = "//[#@] source[M]appingURL=([^\\s'\"]+)";
          const matches = text.match(new RegExp(MAP_COMMENT + "\\s*$", "m")) || text.match(new RegExp(MAP_COMMENT));
          if (!matches) return null;
          const ref = matches[1]!;
          if (ref.indexOf("data:") === 0) {
            const comma = ref.indexOf(",");
            const body = ref.slice(comma + 1);
            const json = /;base64/.test(ref.slice(0, comma)) ? decodeURIComponent(escape(win.atob(body))) : decodeURIComponent(body);
            return { map: JSON.parse(json), base: bare };
          }
          const at = new win.URL(ref, bare).href;
          return fetchText(at).then((json) => (json === "" ? null : { map: JSON.parse(json), base: at }));
        })
        .then((found: any) => (found === null ? null : { ...found, decoded: tools.decode(String(found.map.mappings || "")) }))
        .catch(() => null);
      maps.set(bare, found);
    }
    return found;
  };
  const resolveRaw = (raw: RawSource): Promise<{ file: string; line: number; col: number; mapped: boolean } | null> => {
    if (raw.file !== undefined) return Promise.resolve({ file: raw.file, line: raw.line, col: raw.col, mapped: true });
    const url = raw.url ?? "";
    if (!/^https?:/.test(url)) return Promise.resolve({ file: url, line: raw.line, col: raw.col, mapped: false });
    return mapOf(url).then((found: any) => {
      if (found === null) return { file: new win.URL(url).pathname, line: raw.line, col: raw.col, mapped: false };
      const at = tools.original(found.decoded, raw.line, raw.col);
      if (at === undefined) return null;
      const name = String((found.map.sources || [])[at.source] || "");
      const root = typeof found.map.sourceRoot === "string" && found.map.sourceRoot !== "" ? found.map.sourceRoot.replace(/\/?$/, "/") : "";
      let file = root + name;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(file)) {
        try {
          file = decodeURIComponent(new win.URL(file, found.base).pathname);
        } catch {
          return { file, line: at.line, col: at.col, mapped: true };
        }
      }
      return { file, line: at.line, col: at.col, mapped: true };
    });
  };

  const resolve = (el: any) => {
    const described = describe(el);
    if (described === null) return Promise.resolve(null);
    return resolveRaw(described.raw).then((source) => ({ ...described, source }));
  };

  const find = (target: any): any => {
    if (target === null || typeof target !== "object") return null;
    if (typeof target.key === "string") {
      const twins = sameSite(target.key);
      const index = typeof target.index === "number" ? target.index : 0;
      if (twins[index]) return twins[index];
    }
    if (typeof target.stamp === "string") {
      const stamped = doc.querySelector('[data-hf-id="' + target.stamp + '"]');
      if (stamped !== null) return stamped;
    }
    if (typeof target.selector === "string") {
      try {
        return doc.querySelector(target.selector);
      } catch {
        return null;
      }
    }
    return null;
  };

  const measure = (target: any) => {
    const el = find(target);
    if (el === null) return { found: false, computed: {}, text: null };
    const style = win.getComputedStyle(el);
    const computed: Record<string, string> = {};
    for (const property of Array.isArray(target.properties) ? target.properties : []) computed[property] = style.getPropertyValue(property);
    const attributes: Record<string, string | null> = {};
    for (const name of Array.isArray(target.attributes) ? target.attributes : []) attributes[name] = el.getAttribute(name);
    return { found: true, computed, text: el.textContent, className: el.getAttribute("class"), attributes };
  };

  win.__unframedSource = { levels, describe, resolve, owner: ownerOf, find, commits: () => commits };

  win.addEventListener("message", (event: any) => {
    if (event.source !== win.parent || !LOOPBACK.test(event.origin)) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === "unframed:source:resolve") {
      const el = find(data.target);
      void (el === null ? Promise.resolve(null) : resolve(el))
        .catch(() => null)
        .then((element: unknown) => post({ type: "unframed:source:resolved", id: data.id, element }));
    } else if (data.type === "unframed:source:measure") {
      const targets = Array.isArray(data.targets) ? data.targets : [];
      post({ type: "unframed:source:measured", id: data.id, results: targets.map(measure), commits });
    }
  });
}

export const sourceModuleSource = (): string =>
  `(${installSourceModule.toString()})(window, { frames: ${stackFrames.toString()}, callsite: ${callsiteFrame.toString()}, decode: ${decodeMappings.toString()}, original: ${originalPosition.toString()}, key: ${sourceKey.toString()} });`;
