export interface PageSnapshot {
  readonly html: string;
  readonly w: number;
  readonly h: number;
  readonly parts: ReadonlyArray<string>;
}

export interface SnapshotHelpers {
  readonly units: typeof inlineViewportUnits;
  readonly urls: typeof rewriteCssUrls;
  readonly selectors: typeof renameSelectors;
  readonly standIns: Readonly<Record<string, string>>;
  readonly blank: typeof blankPixels;
  readonly canvas: typeof readCanvas;
}

export type CanvasReads = ReadonlyMap<unknown, string | null>;

export const STAND_INS: Readonly<Record<string, string>> = {
  canvas: ':is(canvas, img:where([data-uf-stand-in="canvas"]))',
  video: ':is(video, img:where([data-uf-stand-in="video"]))',
};

const ROOTS: Readonly<Record<string, string>> = { html: "[data-uf-html]", body: "[data-uf-body]", ":root": "[data-uf-html]" };

export function blankPixels(data: ArrayLike<number>): boolean {
  if (data.length < 4) return false;
  const alpha = data[3];
  for (let at = 0; at + 3 < data.length; at += 4) {
    if (data[at] !== 0 || data[at + 1] !== 0 || data[at + 2] !== 0 || data[at + 3] !== alpha) return false;
  }
  return true;
}

export function readCanvas(win: any, canvas: any, blank: typeof blankPixels): string | null | undefined {
  let data: string;
  try {
    data = canvas.toDataURL();
  } catch {
    return undefined;
  }
  if (typeof data !== "string" || !data.startsWith("data:image/")) return undefined;
  try {
    const probe = win.document.createElement("canvas");
    probe.width = 32;
    probe.height = 32;
    const context = probe.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, 32, 32);
    return blank(context.getImageData(0, 0, 32, 32).data) ? null : data;
  } catch {
    return data;
  }
}

export function inlineViewportUnits(css: string, vw: number, vh: number, rem?: number): string {
  const identChar = /[A-Za-z0-9_\-\u0080-￿]/;
  const hex = /[0-9A-Fa-f]/;
  const number = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
  const unit = rem === undefined ? /(vmin|vmax|dvh|svh|lvh|dvw|svw|lvw|vw|vh)(?![A-Za-z0-9_\-\u0080-￿])/iy : /(vmin|vmax|dvh|svh|lvh|dvw|svw|lvw|vw|vh|rem)(?![A-Za-z0-9_\-\u0080-￿])/iy;
  const skipString = (from: number): number => {
    const quote = css[from];
    let at = from + 1;
    while (at < css.length && css[at] !== quote) at += css[at] === "\\" ? 2 : 1;
    return Math.min(at + 1, css.length);
  };
  let out = "";
  let at = 0;
  let afterIdent = false;
  while (at < css.length) {
    const char = css[at]!;
    if (char === "/" && css[at + 1] === "*") {
      const end = css.indexOf("*/", at + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(at, stop);
      at = stop;
      afterIdent = false;
      continue;
    }
    if (char === '"' || char === "'") {
      const stop = skipString(at);
      out += css.slice(at, stop);
      at = stop;
      afterIdent = false;
      continue;
    }
    if (char === "\\") {
      let stop = at + 1;
      if (stop < css.length && hex.test(css[stop]!)) {
        while (stop < css.length && stop - at <= 6 && hex.test(css[stop]!)) stop++;
        if (stop < css.length && /\s/.test(css[stop]!)) stop++;
      } else stop = Math.min(stop + 1, css.length);
      out += css.slice(at, stop);
      at = stop;
      afterIdent = true;
      continue;
    }
    if (!afterIdent && (char === "u" || char === "U") && css.slice(at, at + 4).toLowerCase() === "url(") {
      let stop = at + 4;
      while (stop < css.length && css[stop] !== ")") {
        if (css[stop] === '"' || css[stop] === "'") stop = skipString(stop);
        else stop += css[stop] === "\\" ? 2 : 1;
      }
      stop = Math.min(stop + 1, css.length);
      out += css.slice(at, stop);
      at = stop;
      afterIdent = false;
      continue;
    }
    if (!afterIdent && /[0-9.+-]/.test(char)) {
      number.lastIndex = at;
      const found = number.exec(css);
      if (found !== null) {
        const end = at + found[0].length;
        unit.lastIndex = end;
        const suffix = unit.exec(css);
        if (suffix !== null) {
          const value = Number(found[0]);
          const name = suffix[1]!.toLowerCase();
          const scale = name === "rem" ? rem! : name === "vmin" ? Math.min(vw, vh) / 100 : name === "vmax" ? Math.max(vw, vh) / 100 : name.endsWith("w") ? vw / 100 : vh / 100;
          const px = Math.round(value * scale * 100) / 100;
          out += `${px === 0 ? 0 : px}px`;
          at = end + suffix[0].length;
        } else {
          out += found[0];
          at = end;
        }
        afterIdent = true;
        continue;
      }
    }
    out += char;
    afterIdent = identChar.test(char);
    at++;
  }
  return out;
}

export function rewriteCssUrls(css: string, map: (url: string) => string): string {
  const identChar = /[A-Za-z0-9_\-\u0080-￿]/;
  const hex = /[0-9A-Fa-f]/;
  const space = /[ \t\n\r\f]/;
  const unescape = (raw: string): string => {
    let value = "";
    for (let at = 0; at < raw.length; at++) {
      const char = raw[at]!;
      if (char !== "\\") {
        value += char;
        continue;
      }
      const next = raw[at + 1];
      if (next === undefined) break;
      if (next === "\n") {
        at++;
        continue;
      }
      if (hex.test(next)) {
        let end = at + 1;
        while (end < raw.length && end - at <= 6 && hex.test(raw[end]!)) end++;
        const code = parseInt(raw.slice(at + 1, end), 16);
        value += code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "�" : String.fromCodePoint(code);
        at = end - 1;
        if (end < raw.length && space.test(raw[end]!)) at++;
        continue;
      }
      value += next;
      at++;
    }
    return value;
  };
  const quote = (value: string): string => `url("${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ").replace(/\r/g, "\\d ").replace(/\f/g, "\\c ")}")`;
  const skipString = (from: number): number => {
    const mark = css[from];
    let at = from + 1;
    while (at < css.length && css[at] !== mark) at += css[at] === "\\" ? 2 : 1;
    return Math.min(at + 1, css.length);
  };
  let out = "";
  let at = 0;
  let afterIdent = false;
  while (at < css.length) {
    const char = css[at]!;
    if (char === "/" && css[at + 1] === "*") {
      const end = css.indexOf("*/", at + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(at, stop);
      at = stop;
      afterIdent = false;
      continue;
    }
    if (char === '"' || char === "'") {
      const stop = skipString(at);
      out += css.slice(at, stop);
      at = stop;
      afterIdent = false;
      continue;
    }
    if (char === "\\") {
      out += css.slice(at, at + 2);
      at += 2;
      afterIdent = true;
      continue;
    }
    if (!afterIdent && (char === "u" || char === "U") && css.slice(at, at + 4).toLowerCase() === "url(") {
      let cursor = at + 4;
      while (cursor < css.length && space.test(css[cursor]!)) cursor++;
      let raw: string | undefined;
      if (css[cursor] === '"' || css[cursor] === "'") {
        const stop = skipString(cursor);
        raw = unescape(css.slice(cursor + 1, stop - 1));
        cursor = stop;
        while (cursor < css.length && space.test(css[cursor]!)) cursor++;
      } else {
        const start = cursor;
        while (cursor < css.length && css[cursor] !== ")" && !space.test(css[cursor]!)) cursor += css[cursor] === "\\" ? 2 : 1;
        raw = unescape(css.slice(start, Math.min(cursor, css.length)));
        while (cursor < css.length && space.test(css[cursor]!)) cursor++;
      }
      if (css[cursor] !== ")") {
        out += css.slice(at);
        break;
      }
      const original = css.slice(at, cursor + 1);
      const mapped = map(raw);
      out += mapped === raw && /^\s*data:/i.test(raw) ? original : quote(mapped);
      at = cursor + 1;
      afterIdent = false;
      continue;
    }
    out += char;
    afterIdent = identChar.test(char);
    at++;
  }
  return out;
}

export function renameSelectors(selectorText: string, names: Readonly<Record<string, string>>): string {
  const named = (key: string): string | undefined => (Object.prototype.hasOwnProperty.call(names, key) ? names[key] : undefined);
  const identChar = /[A-Za-z0-9_\-\u0080-￿]/;
  const hex = /[0-9A-Fa-f]/;
  const selectorArguments = /^(is|where|not|has|matches|-webkit-any|-moz-any|host|host-context|nth-child|nth-last-child|current|past|future)$/i;
  const text = selectorText;
  const skipString = (from: number): number => {
    const mark = text[from];
    let at = from + 1;
    while (at < text.length && text[at] !== mark) at += text[at] === "\\" ? 2 : 1;
    return Math.min(at + 1, text.length);
  };
  const escapeEnd = (from: number): number => {
    let stop = from + 1;
    if (stop < text.length && hex.test(text[stop]!)) {
      while (stop < text.length && stop - from <= 6 && hex.test(text[stop]!)) stop++;
      if (stop < text.length && /\s/.test(text[stop]!)) stop++;
      return stop;
    }
    return Math.min(stop + 1, text.length);
  };
  const identEnd = (from: number): number => {
    let at = from;
    while (at < text.length) {
      if (text[at] === "\\") at = escapeEnd(at);
      else if (identChar.test(text[at]!)) at++;
      else break;
    }
    return at;
  };
  const balancedEnd = (open: number): number => {
    let depth = 0;
    let at = open;
    while (at < text.length) {
      const char = text[at]!;
      if (char === '"' || char === "'") {
        at = skipString(at);
        continue;
      }
      if (char === "\\") {
        at = escapeEnd(at);
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0) return at + 1;
      }
      at++;
    }
    return text.length;
  };
  let out = "";
  let at = 0;
  let afterIdent = false;
  while (at < text.length) {
    const char = text[at]!;
    if (char === '"' || char === "'") {
      const stop = skipString(at);
      out += text.slice(at, stop);
      at = stop;
      continue;
    }
    if (char === "[") {
      let stop = at + 1;
      while (stop < text.length && text[stop] !== "]") {
        if (text[stop] === '"' || text[stop] === "'") stop = skipString(stop);
        else if (text[stop] === "\\") stop = escapeEnd(stop);
        else stop++;
      }
      stop = Math.min(stop + 1, text.length);
      out += text.slice(at, stop);
      at = stop;
      afterIdent = true;
      continue;
    }
    if (char === "." || char === "#" || char === "|") {
      const stop = identEnd(at + 1);
      out += text.slice(at, stop);
      at = stop;
      afterIdent = true;
      continue;
    }
    if (char === ":") {
      const element = text[at + 1] === ":";
      const start = at + (element ? 2 : 1);
      const stop = identEnd(start);
      const name = text.slice(start, stop);
      if (text[stop] === "(") {
        if (!element && selectorArguments.test(name)) {
          out += text.slice(at, stop + 1);
          at = stop + 1;
          afterIdent = false;
          continue;
        }
        const end = balancedEnd(stop);
        out += text.slice(at, end);
        at = end;
        afterIdent = true;
        continue;
      }
      out += (element ? undefined : named(`:${name.toLowerCase()}`)) ?? text.slice(at, stop);
      at = stop;
      afterIdent = true;
      continue;
    }
    if (char === "\\" || identChar.test(char)) {
      const stop = identEnd(at);
      const word = text.slice(at, stop);
      out += (afterIdent ? undefined : named(word.toLowerCase())) ?? word;
      at = stop;
      afterIdent = true;
      continue;
    }
    out += char;
    afterIdent = false;
    at++;
  }
  return out;
}

export const rootSelectors = (selectorText: string): string => renameSelectors(selectorText, ROOTS);

export const standInSelectors = (selectorText: string): string => renameSelectors(selectorText, STAND_INS);

export function snapshotPage(win: any, helpers: SnapshotHelpers, reads?: CanvasReads): PageSnapshot {
  const doc = win.document;
  const HTML = "http://www.w3.org/1999/xhtml";
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const DROP = new Set(["script", "noscript", "template", "link", "meta", "base", "style", "title", "noembed", "noframes"]);
  const FRAMES = new Set(["iframe", "frame", "object", "embed"]);
  const NAME = /^[^\s"'>/=\u0000-\u001f]+$/;
  const DROPPED = /^(on.*|srcset|sizes|nonce|integrity|autofocus|loading)$/i;
  const STAND_IN_KEPT = /^(id|class|style|width|height|role|title|slot|hidden|aria-.+|data-.+)$/i;
  const STAND_IN_TYPES = /canvas|video/i;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const rem = parseFloat(rootStyle.fontSize) || 16;
  const parts: string[] = [];
  const numbers = new Map<string, number>();
  const part = (url: string): string => {
    let number = numbers.get(url);
    if (number === undefined) {
      number = parts.length;
      parts.push(url);
      numbers.set(url, number);
    }
    return `uf-part:${number}`;
  };
  const reference = (raw: string, base: string): string => {
    const value = raw.trim();
    if (value === "" || value[0] === "#" || /^data:/i.test(value)) return raw;
    let absolute: string;
    try {
      absolute = new win.URL(value, base).href;
    } catch {
      return raw;
    }
    if (!/^(https?|blob):/i.test(absolute)) return raw;
    const hash = absolute.indexOf("#");
    return hash === -1 ? part(absolute) : part(absolute.slice(0, hash)) + absolute.slice(hash);
  };
  const css = (text: string, base: string): string => helpers.urls(helpers.units(text, vw, vh, rem), (url) => reference(url, base));
  const matches = (query: string | undefined): boolean => {
    if (query === undefined || query === null || query.trim() === "" || query.trim() === "all") return true;
    try {
      return win.matchMedia(query).matches;
    } catch {
      return true;
    }
  };
  const readable = (sheet: any): any => {
    try {
      return sheet.cssRules;
    } catch {
      return null;
    }
  };
  const is = (rule: any, name: string): boolean => typeof win[name] === "function" && rule instanceof win[name];
  const ruleText = (rule: any, base: string): string => {
    if (is(rule, "CSSImportRule")) {
      if (!matches(rule.media?.mediaText)) return "";
      const sheet = rule.styleSheet;
      const inner = sheet ? readable(sheet) : null;
      if (!inner) return "";
      const body = rulesText(inner, sheet.href || base);
      if (rule.layerName === null || rule.layerName === undefined) return body;
      return rule.layerName === "" ? `@layer{${body}}` : `@layer ${rule.layerName}{${body}}`;
    }
    if (is(rule, "CSSMediaRule")) return matches(rule.media.mediaText) ? rulesText(rule.cssRules, base) : "";
    if (is(rule, "CSSPageRule")) return "";
    if (is(rule, "CSSStyleRule")) {
      const selector = STAND_IN_TYPES.test(rule.selectorText) ? helpers.selectors(rule.selectorText, helpers.standIns) : rule.selectorText;
      if (rule.cssRules && rule.cssRules.length > 0) return `${selector}{${css(rule.style.cssText, base)}${rulesText(rule.cssRules, base)}}`;
      return selector === rule.selectorText ? css(rule.cssText, base) : `${selector}{${css(rule.style.cssText, base)}}`;
    }
    if (is(rule, "CSSKeyframesRule") || is(rule, "CSSFontFaceRule") || !rule.cssRules) return css(rule.cssText, base);
    const whole = String(rule.cssText);
    const open = whole.indexOf("{");
    if (open === -1) return css(whole, base);
    return `${css(whole.slice(0, open), base)}{${rulesText(rule.cssRules, base)}}`;
  };
  const rulesText = (list: any, base: string): string => {
    let out = "";
    for (let index = 0; index < list.length; index++) {
      const text = ruleText(list[index], base);
      if (text !== "") out += `${text}\n`;
    }
    return out;
  };
  const sheetsText = (sheets: any[]): string => {
    let out = "";
    for (const sheet of sheets) {
      if (!sheet || sheet.disabled) continue;
      if (sheet.media && !matches(sheet.media.mediaText)) continue;
      const list = readable(sheet);
      if (!list) continue;
      out += rulesText(list, sheet.href || doc.baseURI);
    }
    return out.replace(/<\/(style)/gi, "<\\/$1");
  };
  const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
  const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/ /g, "&nbsp;");
  const attributes = (values: Map<string, string>): string => {
    let out = "";
    for (const [name, value] of values) out += value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
    return out;
  };
  const KEYFRAME_META = new Set(["offset", "computedOffset", "easing", "composite"]);
  const cssName = (name: string): string => (name === "cssFloat" ? "float" : name.startsWith("--") ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  const pinned = new Map<any, string>();
  const pinAnimations = (): void => {
    let animations: any[] = [];
    try {
      animations = typeof doc.getAnimations === "function" ? Array.from(doc.getAnimations()) : [];
    } catch {
      return;
    }
    for (const animation of animations.slice(0, 500)) {
      const effect = animation.effect;
      const target = effect?.target;
      if (!target || effect.pseudoElement || typeof effect.getKeyframes !== "function" || animation.currentTime === null) continue;
      if (animation.playState !== "running" && animation.playState !== "paused") continue;
      let frames: any[];
      let timing: any;
      try {
        frames = effect.getKeyframes();
        timing = effect.getComputedTiming();
      } catch {
        continue;
      }
      const names = new Set<string>();
      for (const frame of frames) for (const name of Object.keys(frame)) if (!KEYFRAME_META.has(name)) names.add(cssName(name));
      if (names.size === 0) continue;
      let at: number | undefined;
      if (animation.playState === "running") {
        if (timing.iterations === Infinity) {
          let offset = 0;
          let most = -Infinity;
          for (const frame of frames) {
            const opacity = parseFloat(frame.opacity);
            if (Number.isFinite(opacity) && opacity > most) {
              most = opacity;
              offset = frame.computedOffset ?? frame.offset ?? 0;
            }
          }
          const progress = Math.min(Math.max(offset, 0), 0.9999);
          const reversed = timing.direction === "reverse" || timing.direction === "alternate-reverse";
          at = (Number(timing.delay) || 0) + (reversed ? 1 - progress : progress) * (Number(timing.duration) || 0);
        } else if (Number.isFinite(timing.endTime)) at = timing.endTime;
      }
      const saved = animation.currentTime;
      try {
        if (at !== undefined) animation.currentTime = at;
        const style = win.getComputedStyle(target);
        let text = pinned.get(target) ?? "";
        for (const name of names) {
          const value = style.getPropertyValue(name);
          if (value !== "") text += `;${name}:${value} !important`;
        }
        pinned.set(target, text);
      } catch {
        continue;
      } finally {
        if (at !== undefined) animation.currentTime = saved;
      }
    }
  };
  pinAnimations();
  const transparent = (style: any): boolean => (style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)") && style.backgroundImage === "none";
  const baseOf = (): string => doc.baseURI;
  const own = (element: any): Map<string, string> => {
    const values = new Map<string, string>();
    for (const attribute of Array.from(element.attributes as ArrayLike<any>)) {
      if (!NAME.test(attribute.name) || DROPPED.test(attribute.name)) continue;
      values.set(attribute.name, attribute.name === "style" ? css(attribute.value, baseOf()) : attribute.value);
    }
    const pin = pinned.get(element);
    if (pin !== undefined) {
      const style = values.get("style");
      values.set("style", `${style ?? ""}${css(pin, baseOf())}`.replace(/^;/, ""));
    }
    const top = element.scrollTop;
    const left = element.scrollLeft;
    if ((top !== 0 || left !== 0) && element !== doc.documentElement && element !== doc.body) values.set("data-uf-scroll", `${Math.round(top)},${Math.round(left)}`);
    return values;
  };
  const sized = (values: Map<string, string>, element: any): void => {
    const extra = `width:${element.offsetWidth}px;height:${element.offsetHeight}px`;
    const style = values.get("style");
    values.set("style", style ? `${style};${extra}` : extra);
  };
  const keep = (values: Map<string, string>, names: string[]): Map<string, string> => {
    const kept = new Map<string, string>();
    for (const name of names) if (values.has(name)) kept.set(name, values.get(name)!);
    return kept;
  };
  const picture = (data: string | undefined, element: any, values: Map<string, string>, out: string[], kind: string): void => {
    const kept = new Map<string, string>();
    for (const [name, value] of values) if (STAND_IN_KEPT.test(name)) kept.set(name, value);
    kept.set("data-uf-stand-in", kind);
    if (data === undefined) kept.set("alt", "");
    else kept.set("src", part(data));
    sized(kept, element);
    out.push(`<img${attributes(kept)}>`);
  };
  const shadow = (root: any, out: string[]): void => {
    out.push('<template shadowrootmode="open">');
    const style = sheetsText([...Array.from(root.styleSheets as ArrayLike<any>), ...Array.from((root.adoptedStyleSheets ?? []) as ArrayLike<any>)]);
    if (style !== "") out.push(`<style>${style}</style>`);
    children(root, out);
    out.push("</template>");
  };
  const children = (parent: any, out: string[]): void => {
    const nodes = parent.childNodes;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.nodeType === 1) element(node, out);
      else if (node.nodeType === 3 || node.nodeType === 4) out.push(escapeText(node.data));
    }
  };
  const element = (node: any, out: string[]): void => {
    const local = String(node.localName);
    const html = node.namespaceURI === HTML;
    if (local === "script" || local === "style") return;
    if (html && DROP.has(local)) return;
    if (html && local === "source" && node.parentElement?.localName === "picture") return;
    const values = own(node);
    if (html && FRAMES.has(local)) {
      const kept = keep(values, ["id", "class", "style"]);
      sized(kept, node);
      out.push(`<div${attributes(kept)}></div>`);
      return;
    }
    if (html && local === "canvas") {
      const read = reads !== undefined && reads.has(node) ? reads.get(node) : helpers.canvas(win, node, helpers.blank);
      if (read !== undefined) {
        picture(read ?? undefined, node, values, out, "canvas");
        return;
      }
    }
    if (html && local === "video") {
      let data: string | undefined;
      try {
        if (node.readyState >= 2 && node.videoWidth > 0) {
          const canvas = doc.createElement("canvas");
          canvas.width = node.videoWidth;
          canvas.height = node.videoHeight;
          canvas.getContext("2d").drawImage(node, 0, 0);
          data = canvas.toDataURL();
        }
      } catch {
        data = undefined;
      }
      if (data !== undefined && data.startsWith("data:image/")) {
        const fit = win.getComputedStyle(node).objectFit;
        values.set("style", `${values.get("style") ?? ""};object-fit:${fit === "fill" ? "contain" : fit}`);
        picture(data, node, values, out, "video");
        return;
      }
      values.delete("src");
      values.delete("autoplay");
      if (values.has("poster")) values.set("poster", reference(values.get("poster")!, baseOf()));
      out.push(`<video${attributes(values)}></video>`);
      return;
    }
    if (html && local === "audio") {
      values.delete("src");
      values.delete("autoplay");
      out.push(`<audio${attributes(values)}></audio>`);
      return;
    }
    if (html && local === "img") {
      const source = node.currentSrc || node.getAttribute("src") || "";
      if (source === "") values.delete("src");
      else values.set("src", reference(source, baseOf()));
    }
    if (html && local === "source" && values.has("src")) values.set("src", reference(values.get("src")!, baseOf()));
    if (html && local === "input") {
      const type = String(node.type).toLowerCase();
      if (type === "image" && values.has("src")) values.set("src", reference(values.get("src")!, baseOf()));
      if (type === "checkbox" || type === "radio") {
        if (node.checked) values.set("checked", "");
        else values.delete("checked");
      } else if (type === "password") values.set("value", "x".repeat(String(node.value).length));
      else if (type === "file") values.delete("value");
      else values.set("value", String(node.value));
    }
    if (html && local === "option") {
      if (node.selected) values.set("selected", "");
      else values.delete("selected");
    }
    if (html && local === "dialog") {
      try {
        if (node.matches(":modal")) values.set("data-uf-modal", "");
      } catch {
        values.delete("data-uf-modal");
      }
    }
    if (node.hasAttribute?.("popover")) {
      try {
        if (node.matches(":popover-open")) values.set("data-uf-popover-open", "");
      } catch {
        values.delete("data-uf-popover-open");
      }
    }
    if (!html && (local === "image" || local === "feImage" || local === "use")) {
      for (const name of ["href", "xlink:href"]) {
        const value = values.get(name);
        if (value !== undefined && !value.trim().startsWith("#")) values.set(name, reference(value, baseOf()));
      }
    }
    const tag = html ? local : String(node.tagName);
    out.push(`<${tag}${attributes(values)}`);
    if (html && VOID.has(local)) {
      out.push(">");
      return;
    }
    if (!html && node.childNodes.length === 0 && !node.shadowRoot) {
      out.push("/>");
      return;
    }
    out.push(">");
    if (node.shadowRoot) shadow(node.shadowRoot, out);
    if (html && local === "textarea") {
      const value = String(node.value);
      out.push(`${value.startsWith("\n") ? "\n" : ""}${escapeText(value)}</textarea>`);
      return;
    }
    if (html && (local === "pre" || local === "listing")) {
      const first = node.firstChild;
      if (first && first.nodeType === 3 && String(first.data).startsWith("\n")) out.push("\n");
    }
    children(node, out);
    out.push(`</${tag}>`);
  };

  const htmlValues = own(doc.documentElement);
  const scrollX = Math.round(win.scrollX || 0);
  const scrollY = Math.round(win.scrollY || 0);
  if (scrollX !== 0 || scrollY !== 0) htmlValues.set("data-uf-scroll", `${scrollY},${scrollX}`);
  if (transparent(rootStyle)) {
    const bodyStyle = doc.body ? win.getComputedStyle(doc.body) : undefined;
    const fill = bodyStyle && (bodyStyle.backgroundColor !== "transparent" && bodyStyle.backgroundColor !== "rgba(0, 0, 0, 0)") ? bodyStyle.backgroundColor : "Canvas";
    const style = htmlValues.get("style");
    htmlValues.set("style", style ? `${style};background-color:${fill}` : `background-color:${fill}`);
  }
  const body: string[] = [];
  let bodyValues = new Map<string, string>();
  if (doc.body) {
    bodyValues = own(doc.body);
    const top = doc.body.scrollTop;
    const left = doc.body.scrollLeft;
    if ((top !== 0 || left !== 0) && doc.scrollingElement !== doc.body) bodyValues.set("data-uf-scroll", `${Math.round(top)},${Math.round(left)}`);
    if (doc.body.shadowRoot) shadow(doc.body.shadowRoot, body);
    children(doc.body, body);
  }
  const style = sheetsText([...Array.from(doc.styleSheets as ArrayLike<any>), ...Array.from((doc.adoptedStyleSheets ?? []) as ArrayLike<any>)]);
  const html = `<!doctype html><html${attributes(htmlValues)}><head><meta charset="utf-8"><style>${style}</style></head><body${attributes(bodyValues)}>${body.join("")}</body></html>`;
  return { html, w: vw, h: vh, parts };
}

const FAMILY_WORDS = /^-?[A-Za-z_\u0080-￿][\w\-\u0080-￿]*(?:\s+-?[A-Za-z_\u0080-￿][\w\-\u0080-￿]*)*$/;

export const fontFamilyKey = (item: string): string | undefined => {
  const text = item.trim();
  const quoted = /^(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/.exec(text);
  if (quoted !== null) return quoted[2]!.replace(/\\([\s\S])/g, "$1").toLowerCase();
  return FAMILY_WORDS.test(text) ? text.split(/\s+/).join(" ").toLowerCase() : undefined;
};

export const scopeFontFamilies = (value: string, scoped: ReadonlyMap<string, string>): string => {
  if (scoped.size === 0) return value;
  let out = "";
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  const flush = (end: number) => {
    const item = value.slice(start, end);
    const key = fontFamilyKey(item);
    const to = key === undefined ? undefined : scoped.get(key);
    if (to === undefined) out += item;
    else {
      const lead = item.length - item.trimStart().length;
      const trail = item.length - item.trimEnd().length;
      out += `${item.slice(0, lead)}"${to}"${item.slice(item.length - trail)}`;
    }
  };
  for (let at = 0; at < value.length; at++) {
    const char = value[at]!;
    if (char === "\\") at++;
    else if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      flush(at);
      out += ",";
      start = at + 1;
    }
  }
  flush(value.length);
  return out;
};
