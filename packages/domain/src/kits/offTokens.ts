import { parseHTML } from "linkedom";
import { cubicBezierOf } from "./easings.ts";
import { parseStylesheet } from "./css.ts";
import { kitCssNames } from "./rules.ts";
import { cssName, resolve } from "./runtime.ts";
import { colourDistance, firstFamily, isShadow, lengthPx, normaliseShadow, parseBezier, parseColour, parseLength, parseTime, parseWeight, weightNumber, type OkColour } from "./values.ts";
import { TEXT_STYLE_SUFFIX, type Kit, type TextStyle, type TextStyleField } from "./types.ts";

export interface StyleRuleRef {
  readonly block: number;
  readonly selector: string;
  readonly occurrence: number;
}

export type OffTokenPlace = { readonly elementId: string } | { readonly rule: StyleRuleRef };

export interface OffTokenValue {
  readonly place: OffTokenPlace;
  readonly property: string;
  readonly value: string;
  readonly path: string;
  readonly css: string;
  readonly tokenValue: string;
  readonly exact: boolean;
}

interface Match {
  readonly path: string;
  readonly css: string;
  readonly tokenValue: string;
  readonly exact: boolean;
  readonly difference: number;
  readonly keyword: number;
  readonly order: number;
}

const SPACING = ["space", "spacing", "gap"];
const RADIUS = ["radius", "radii", "rounded"];
const TEXT = ["font", "text", "size"];
const SPACING_PROPERTY = /^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$/;
const RADIUS_PROPERTY = /^border-radius/;
const TEXT_PROPERTY: Readonly<Record<string, TextStyleField>> = { "font-size": "fontSize", "line-height": "lineHeight", "letter-spacing": "letterSpacing" };
const NOT_COLOUR = /^(font-family|font-weight|animation-name|content|font-feature-settings|grid-area|grid-template-areas)$/;

const rank = (path: string, keywords: string[]): number => (path.split("/").some((segment) => keywords.includes(segment)) ? 0 : 1);

const withoutCalls = (value: string, name: RegExp): string => {
  let out = value;
  for (let match = name.exec(out); match !== null; match = name.exec(out)) {
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < out.length; i++) {
      if (out[i] === "(") depth++;
      if (out[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    out = out.slice(0, match.index) + " " + out.slice(end + 1);
    name.lastIndex = 0;
  }
  return out;
};

const colourLiterals = (value: string): string[] => {
  const found: string[] = [];
  let rest = value.replace(/(?:rgba?|hsla?|oklch)\([^()]*\)/gi, (text) => {
    found.push(text);
    return " ";
  });
  rest = rest.replace(/#[0-9a-f]{3,8}(?![0-9a-z])/gi, (text) => {
    found.push(text);
    return " ";
  });
  for (const word of rest.match(/(?<![-\w#.])[a-z]+(?![-\w(])/gi) ?? []) {
    if (word.toLowerCase() !== "transparent" && parseColour(word) !== null) found.push(word);
  }
  return found;
};

const lengthLiterals = (value: string): string[] => value.match(/(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)(?![\w])/gi) ?? [];

const timeLiterals = (value: string): string[] => value.match(/(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?:ms|s)(?![\w])/gi) ?? [];

interface LengthOffer {
  readonly path: string;
  readonly css: string;
  readonly text: string;
  readonly px: number | undefined;
  readonly percent: boolean;
  readonly keyword: number;
  readonly order: number;
}

const better = (a: Match, b: Match): boolean => {
  if (a.exact !== b.exact) return a.exact;
  if (a.difference !== b.difference) return a.difference < b.difference;
  if (a.keyword !== b.keyword) return a.keyword < b.keyword;
  return a.order < b.order;
};

const scanDeclaration = (kit: Kit, property: string, rawValue: string): Array<{ literal: string; match: Match }> => {
  const found: Array<{ literal: string; match: Match }> = [];
  let order = 0;
  const modesOf = (path: string) => kit.modes.map((mode) => ({ mode, value: resolve(kit, path, mode) }));
  const offer = (literal: string, candidates: Match[]) => {
    if (candidates.length === 0) return;
    found.push({ literal, match: candidates.reduce((best, next) => (better(next, best) ? next : best)) });
  };
  const value = withoutCalls(withoutCalls(rawValue, /var\(/gi), /url\(/gi);
  const bezierText = /cubic-bezier\([^()]*\)/gi;
  const timed = /^(transition|animation)/.test(property);
  const plainValue = value.replace(bezierText, " ");

  if (!NOT_COLOUR.test(property)) {
    for (const literal of colourLiterals(value)) {
      const colour: OkColour | null = parseColour(literal);
      if (colour === null || colour.alpha === 0) continue;
      const candidates: Match[] = [];
      for (const token of kit.tokens) {
        if (token.type !== "color") continue;
        for (const { value: raw } of modesOf(token.path)) {
          if (typeof raw !== "string") continue;
          const other = parseColour(raw);
          if (other === null || other.alpha === 0) continue;
          const distance = colourDistance(colour, other);
          const alphaGap = Math.abs(colour.alpha - other.alpha);
          const exact = distance < 0.05 && alphaGap <= 0.001;
          const near = distance <= 2 && alphaGap <= 0.02;
          if (!exact && !near) continue;
          candidates.push({ path: token.path, css: cssName(token.path), tokenValue: raw, exact, difference: distance, keyword: 0, order: order++ });
        }
      }
      offer(literal, candidates);
    }
  }

  const spacing = SPACING_PROPERTY.test(property);
  const radius = RADIUS_PROPERTY.test(property);
  const textField = TEXT_PROPERTY[property];
  if (spacing || radius || textField !== undefined) {
    const keywords = spacing ? SPACING : radius ? RADIUS : TEXT;
    const offers: LengthOffer[] = [];
    for (const token of kit.tokens) {
      if (token.type === "dimension") {
        for (const { value: raw } of modesOf(token.path)) {
          if (typeof raw !== "string") continue;
          const length = parseLength(raw);
          if (length === null) continue;
          offers.push({ path: token.path, css: cssName(token.path), text: raw, px: lengthPx(length), percent: length.unit === "%", keyword: rank(token.path, keywords), order: order++ });
        }
      }
      if (token.type === "textStyle" && textField !== undefined) {
        for (const { value: raw } of modesOf(token.path)) {
          if (raw === undefined || typeof raw !== "object") continue;
          const style = raw as TextStyle;
          const fieldValue = style[textField];
          const length = typeof fieldValue === "string" ? parseLength(fieldValue) : null;
          if (length === null) continue;
          const css = `${cssName(token.path)}-${TEXT_STYLE_SUFFIX[textField]}`;
          offers.push({ path: token.path, css, text: String(fieldValue), px: lengthPx(length), percent: length.unit === "%", keyword: rank(token.path, keywords), order: order++ });
        }
      }
    }
    for (const literal of lengthLiterals(plainValue)) {
      const length = parseLength(literal);
      if (length === null) continue;
      const px = lengthPx(length);
      if (px === undefined) {
        const candidates = offers.filter((offer) => offer.percent && parseLength(offer.text)?.value === length.value).map((offer) => ({ path: offer.path, css: offer.css, tokenValue: offer.text, exact: true, difference: 0, keyword: offer.keyword, order: offer.order }));
        offer(literal, candidates);
        continue;
      }
      if (px <= 1) continue;
      const candidates: Match[] = [];
      for (const offerItem of offers) {
        if (offerItem.percent || offerItem.px === undefined) continue;
        const gap = Math.abs(px - offerItem.px);
        const exact = gap === 0;
        const near = gap <= 2 && gap <= 0.125 * Math.abs(offerItem.px);
        if (!exact && !near) continue;
        candidates.push({ path: offerItem.path, css: offerItem.css, tokenValue: offerItem.text, exact, difference: gap, keyword: offerItem.keyword, order: offerItem.order });
      }
      offer(literal, candidates);
    }
  }

  if (property === "font-weight") {
    const literal = value.trim();
    const weight = weightNumber(literal);
    if (weight !== undefined && parseWeight(literal)) {
      const candidates: Match[] = [];
      for (const token of kit.tokens) {
        if (token.type !== "fontWeight") continue;
        for (const { value: raw } of modesOf(token.path)) {
          if (raw === undefined || typeof raw === "object") continue;
          if (weightNumber(raw) === weight) candidates.push({ path: token.path, css: cssName(token.path), tokenValue: String(raw), exact: true, difference: 0, keyword: 0, order: order++ });
        }
      }
      offer(literal, candidates);
    }
  }

  if (property === "font-family") {
    const literal = value.trim();
    const family = firstFamily(literal);
    if (family !== "") {
      const candidates: Match[] = [];
      for (const token of kit.tokens) {
        if (token.type !== "fontFamily") continue;
        for (const { value: raw } of modesOf(token.path)) {
          if (typeof raw === "string" && firstFamily(raw) === family) candidates.push({ path: token.path, css: cssName(token.path), tokenValue: raw, exact: true, difference: 0, keyword: 0, order: order++ });
        }
      }
      offer(literal, candidates);
    }
  }

  if (property === "box-shadow" && isShadow(value)) {
    const literal = value.trim();
    const normal = normaliseShadow(literal);
    const candidates: Match[] = [];
    for (const token of kit.tokens) {
      if (token.type !== "shadow") continue;
      for (const { value: raw } of modesOf(token.path)) {
        if (typeof raw === "string" && normaliseShadow(raw) === normal) candidates.push({ path: token.path, css: cssName(token.path), tokenValue: raw, exact: true, difference: 0, keyword: 0, order: order++ });
      }
    }
    offer(literal, candidates);
  }

  if (timed) {
    for (const literal of timeLiterals(plainValue)) {
      const ms = parseTime(literal);
      if (ms === null) continue;
      const candidates: Match[] = [];
      for (const token of kit.tokens) {
        if (token.type !== "duration") continue;
        for (const { value: raw } of modesOf(token.path)) {
          if (typeof raw !== "string") continue;
          const tokenMs = parseTime(raw);
          if (tokenMs === null) continue;
          const gap = Math.abs(ms - tokenMs);
          const exact = gap === 0;
          const near = gap <= 20 || gap <= 0.1 * Math.abs(tokenMs);
          if (!exact && !near) continue;
          candidates.push({ path: token.path, css: cssName(token.path), tokenValue: raw, exact, difference: gap, keyword: 0, order: order++ });
        }
      }
      offer(literal, candidates);
    }
    for (const literal of value.match(bezierText) ?? []) {
      const coords = parseBezier(literal);
      if (coords === null) continue;
      const candidates: Match[] = [];
      for (const token of kit.tokens) {
        if (token.type !== "easing") continue;
        for (const { value: raw } of modesOf(token.path)) {
          if (typeof raw !== "string") continue;
          const other = parseBezier(raw) ?? cubicBezierOf(raw);
          if (other === undefined || other === null) continue;
          if (coords.every((c, i) => Math.abs(c - other[i]!) <= 0.01)) candidates.push({ path: token.path, css: cssName(token.path), tokenValue: raw, exact: true, difference: 0, keyword: 0, order: order++ });
        }
      }
      offer(literal, candidates);
    }
  }
  return found;
};

export const offTokenValues = (html: string, kit: Kit): OffTokenValue[] => {
  if (kit.tokens.length === 0) return [];
  const { document } = parseHTML(html) as unknown as { document: { querySelectorAll(selector: string): ArrayLike<unknown> } };
  const kitNames = new Set(kitCssNames(kit));
  const out: OffTokenValue[] = [];
  const add = (place: OffTokenPlace, property: string, rawValue: string) => {
    for (const { literal, match } of scanDeclaration(kit, property, rawValue)) {
      out.push({ place, property, value: literal, path: match.path, css: match.css, tokenValue: match.tokenValue, exact: match.exact });
    }
  };

  const styles = Array.from(document.querySelectorAll("style")) as unknown as Array<{ textContent: string | null }>;
  styles.forEach((style, block) => {
    const seen = new Map<string, number>();
    for (const rule of parseStylesheet(style.textContent ?? "")) {
      const occurrence = seen.get(rule.selector) ?? 0;
      seen.set(rule.selector, occurrence + 1);
      for (const declaration of rule.declarations) {
        if (kitNames.has(declaration.property)) continue;
        add({ rule: { block, selector: rule.selector, occurrence } }, declaration.property, declaration.value);
      }
    }
  });

  const elements = Array.from(document.querySelectorAll("[data-hf-id]")) as unknown as Array<{ getAttribute(name: string): string | null }>;
  for (const element of elements) {
    const elementId = element.getAttribute("data-hf-id");
    if (!elementId) continue;
    const inline = element.getAttribute("style");
    if (inline !== null) {
      for (const declaration of parseStylesheet(`x{${inline}}`)[0]?.declarations ?? []) {
        if (kitNames.has(declaration.property)) continue;
        add({ elementId }, declaration.property, declaration.value);
      }
    }
    for (const attribute of ["fill", "stroke", "stop-color"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) add({ elementId }, attribute, value);
    }
  }
  return out;
};
