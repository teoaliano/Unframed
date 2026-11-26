import { fontFamilyKey, rootSelectors, scopeFontFamilies } from "@unframed/domain";

export interface PreparedPageCopy {
  readonly template: HTMLTemplateElement;
  readonly sheet: CSSStyleSheet;
  readonly shadows: ReadonlyArray<CSSStyleSheet>;
}

export interface PageCopySize {
  readonly w: number;
  readonly h: number;
}

const BASE_CSS = `
:where([data-uf-html]) { all: initial; display: block; color: CanvasText; }
:where([data-uf-body]) { display: block; margin: 8px; }
:where(dialog[data-uf-modal]) { position: fixed; inset-block: 0; max-width: calc(100% - 6px - 2em); max-height: calc(100% - 6px - 2em); overflow: auto; z-index: 2147483647; }
:where([data-uf-popover-open]) { display: block; z-index: 2147483646; }
`;

const STILL_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: both !important;
  transition: none !important;
  caret-color: transparent !important;
}
`;

const DROPPED = "script, iframe, frame, frameset, object, embed, link, meta, base, style, noscript, title";
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "data", "background"]);
const PARTS = /(?<![\w./-])parts\/([0-9a-f]{40}(?:\.[A-Za-z0-9]+)?)/g;

const prepared = new Map<string, Promise<PreparedPageCopy>>();
const roots = new WeakMap<HTMLElement, ShadowRoot>();
const fontTexts = new Set<string>();
let fontSheet: CSSStyleSheet | undefined;
let baseSheet: CSSStyleSheet | undefined;
let stillSheet: CSSStyleSheet | undefined;
let copies = 0;

type Families = ReadonlyMap<string, string>;

const constructed = (text: string): CSSStyleSheet => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return sheet;
};

const hoistFont = (text: string): void => {
  if (fontTexts.has(text)) return;
  fontTexts.add(text);
  if (fontSheet === undefined) {
    fontSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, fontSheet];
  }
  try {
    fontSheet.insertRule(text, fontSheet.cssRules.length);
  } catch {
    fontTexts.delete(text);
  }
};

const declaredFamilies = (list: CSSRuleList, found: Set<string>): void => {
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSFontFaceRule) {
      const key = fontFamilyKey(rule.style.getPropertyValue("font-family"));
      if (key !== undefined) found.add(key);
    } else if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) declaredFamilies(rule.cssRules, found);
  }
};

const scopedFace = (rule: CSSFontFaceRule, families: Families): string | undefined => {
  const key = fontFamilyKey(rule.style.getPropertyValue("font-family"));
  const family = key === undefined ? undefined : families.get(key);
  if (family === undefined) return undefined;
  let body = `font-family: "${family}";`;
  for (const name of Array.from(rule.style)) {
    if (name !== "font-family") body += ` ${name}: ${rule.style.getPropertyValue(name)};`;
  }
  return `@font-face { ${body} }`;
};

const scopeDeclarations = (style: CSSStyleDeclaration, families: Families): void => {
  if (families.size === 0) return;
  for (const name of Array.from(style)) {
    if (name !== "font-family" && !name.startsWith("--")) continue;
    const value = style.getPropertyValue(name);
    const scoped = scopeFontFamilies(value, families);
    if (scoped !== value) style.setProperty(name, scoped, style.getPropertyPriority(name));
  }
};

const adapt = (list: CSSRuleList, owner: CSSStyleSheet | CSSGroupingRule, selectors: boolean, families: Families): void => {
  for (let index = list.length - 1; index >= 0; index--) {
    const rule = list[index]!;
    if (rule instanceof CSSFontFaceRule) {
      const face = scopedFace(rule, families);
      if (face !== undefined) hoistFont(face);
      owner.deleteRule(index);
      continue;
    }
    if (rule instanceof CSSStyleRule) {
      if (selectors) {
        const mapped = rootSelectors(rule.selectorText);
        if (mapped !== rule.selectorText) rule.selectorText = mapped;
      }
      scopeDeclarations(rule.style, families);
    }
    if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) {
      if (rule.cssRules.length > 0) adapt(rule.cssRules, rule as CSSGroupingRule, selectors, families);
    }
  }
};

const parsedSheet = (text: string): CSSStyleSheet => {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(text);
  } catch {
    return new CSSStyleSheet();
  }
  return sheet;
};

const scopeElements = (root: ParentNode, families: Families): void => {
  if (families.size === 0) return;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element instanceof HTMLElement || element instanceof SVGElement) scopeDeclarations(element.style, families);
    const attribute = element.getAttribute("font-family");
    if (attribute !== null) element.setAttribute("font-family", scopeFontFamilies(attribute, families));
    if (element instanceof HTMLTemplateElement) scopeElements(element.content, families);
  }
};

const scriptUrl = (value: string): boolean => /^\s*(javascript|vbscript):/i.test(value.replace(/[\u0000-\u001f]/g, ""));

const sanitise = (root: ParentNode): void => {
  for (const element of Array.from(root.querySelectorAll(DROPPED))) element.remove();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "autofocus" || name === "srcset" || (URL_ATTRIBUTES.has(name) && scriptUrl(attribute.value))) element.removeAttribute(attribute.name);
    }
    if (element instanceof HTMLTemplateElement) sanitise(element.content);
  }
};

const takeShadows = (root: ParentNode, shadows: CSSStyleSheet[]): void => {
  for (const template of Array.from(root.querySelectorAll("template[shadowrootmode]"))) {
    const content = (template as HTMLTemplateElement).content;
    takeShadows(content, shadows);
    let text = "";
    for (const style of Array.from(content.querySelectorAll("style"))) {
      if (style.parentNode === content) text += style.textContent ?? "";
    }
    template.setAttribute("data-uf-shadow", String(shadows.length));
    template.removeAttribute("shadowrootmode");
    shadows.push(parsedSheet(text));
  }
};

const build = async (url: string, partsUrl: string): Promise<PreparedPageCopy> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the page copy answered ${response.status}`);
  const text = (await response.text()).replace(PARTS, (_, name: string) => `${partsUrl}${name}`);
  const parsed = new DOMParser().parseFromString(text, "text/html");
  let css = "";
  for (const style of Array.from(parsed.head.querySelectorAll("style"))) css += style.textContent ?? "";
  const sheet = parsedSheet(css);
  const shadows: CSSStyleSheet[] = [];
  takeShadows(parsed.body, shadows);
  const declared = new Set<string>();
  for (const each of [sheet, ...shadows]) declaredFamilies(each.cssRules, declared);
  const copy = ++copies;
  const families: Families = new Map([...declared].map((key, index) => [key, `uf${copy}-${index}`]));
  adapt(sheet.cssRules, sheet, true, families);
  for (const shadow of shadows) adapt(shadow.cssRules, shadow, false, families);
  const page = parsed.createElement("div");
  for (const attribute of Array.from(parsed.documentElement.attributes)) page.setAttribute(attribute.name, attribute.value);
  page.setAttribute("data-uf-html", "");
  const body = parsed.createElement("div");
  for (const attribute of Array.from(parsed.body.attributes)) body.setAttribute(attribute.name, attribute.value);
  body.setAttribute("data-uf-body", "");
  body.append(...Array.from(parsed.body.childNodes));
  page.append(body);
  sanitise(page);
  scopeElements(page, families);
  const template = document.createElement("template");
  template.content.append(template.content.ownerDocument.importNode(page, true));
  return { template, sheet, shadows };
};

export const preparePageCopy = (url: string, partsUrl: string): Promise<PreparedPageCopy> => {
  const known = prepared.get(url);
  if (known !== undefined) return known;
  const pending = build(url, partsUrl);
  prepared.set(url, pending);
  pending.catch(() => {
    if (prepared.get(url) === pending) prepared.delete(url);
  });
  return pending;
};

const scrollTo = (element: Element, value: string | null): void => {
  if (value === null) return;
  const [top, left] = value.split(",").map(Number);
  element.scrollTo({ top: top || 0, left: left || 0, behavior: "instant" });
};

const attachShadows = (scope: ParentNode, copy: PreparedPageCopy, scrolled: Element[]): void => {
  for (const template of Array.from(scope.querySelectorAll("template[data-uf-shadow]"))) {
    const host = template.parentElement;
    const sheet = copy.shadows[Number(template.getAttribute("data-uf-shadow"))];
    template.remove();
    if (host === null || sheet === undefined || host.shadowRoot !== null) continue;
    let shadow: ShadowRoot;
    try {
      shadow = host.attachShadow({ mode: "open" });
    } catch {
      continue;
    }
    shadow.adoptedStyleSheets = [sheet, stillSheet!];
    shadow.append((template as HTMLTemplateElement).content);
    scrolled.push(...Array.from(shadow.querySelectorAll("[data-uf-scroll]")));
    attachShadows(shadow, copy, scrolled);
  }
};

export const mountPageCopy = (host: HTMLElement, copy: PreparedPageCopy, size: PageCopySize): (() => void) => {
  baseSheet ??= constructed(BASE_CSS);
  stillSheet ??= constructed(STILL_CSS);
  let root = roots.get(host);
  if (root === undefined) {
    root = host.attachShadow({ mode: "closed" });
    roots.set(host, root);
  }
  root.adoptedStyleSheets = [baseSheet, copy.sheet, stillSheet];
  root.replaceChildren(copy.template.content.cloneNode(true));
  const page = root.firstElementChild as HTMLElement | null;
  if (page !== null) {
    page.style.setProperty("width", `${size.w}px`, "important");
    page.style.setProperty("height", `${size.h}px`, "important");
    page.style.setProperty("overflow", "hidden", "important");
    page.style.setProperty("position", "relative", "important");
    page.inert = true;
    const scrolled = Array.from(root.querySelectorAll("[data-uf-scroll]"));
    attachShadows(root, copy, scrolled);
    for (const element of scrolled) scrollTo(element, element.getAttribute("data-uf-scroll"));
  }
  const mounted = root;
  return () => mounted.replaceChildren();
};
