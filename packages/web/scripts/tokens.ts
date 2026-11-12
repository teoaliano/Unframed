import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type Collection = "Primitives" | "Tokens" | "Theme" | "Components";
type Variable = { collection: Collection; name: string; type: "COLOR" | "FLOAT" | "STRING"; light: string; dark: string; code: string };

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(web, "src/theme/variables.tsv");
const target = join(web, "src/theme/tokens.css");
const tailwindTheme = readFileSync(createRequire(join(web, "package.json")).resolve("tailwindcss/theme.css"), "utf8");

export const EXCEPTIONS = {
  fontFamily: "Figma names the typefaces SF Pro and SF Mono; code asks for the system stack, which is the same face on macOS.",
  primitiveColour: "Figma stores each Tailwind colour as the nearest sRGB hex; code keeps Tailwind's oklch value.",
  runtime: "Base UI, tldraw and the diff viewer set their own custom properties at runtime; code reads them as they are.",
  textRelative: "Lengths in em track the text they sit in (the prompt chip); Figma draws them at one text size.",
  literalColour: "A few literal colours are data, not paint: mask alpha, colour-picker fallbacks for user colours, a user kit's defaults and an export's background.",
  layering: "z-index, transitions and motion live in code only; Figma has no variables for them.",
} as const;

const LITERAL_COLOURS: Record<string, string[]> = {
  "src/theme/button.css": ["#000"],
  "src/theme/vendors.css": ["#000"],
  "src/design/controls.tsx": ["#000000"],
  "src/kits/KitCells.tsx": ["#000000"],
  "src/artifacts/editor/DesignTab.tsx": ["#000000"],
  "src/kits/KitTable.tsx": ["#000000", "rgba(0, 0, 0, 0.2)"],
  "src/generate/render.ts": ["#ffffff"],
  "src/canvas/DesignPanel.tsx": ["rgb(${p3.slice(1, 4)"],
};

const RUNTIME = new Set([
  "--anchor-width",
  "--anchor-height",
  "--available-width",
  "--available-height",
  "--popup-width",
  "--popup-height",
  "--positioner-width",
  "--positioner-height",
  "--transform-origin",
  "--nested-dialogs",
  "--collapsible-panel-height",
  "--collapsible-panel-width",
  "--toast-swipe-movement-x",
  "--toast-swipe-movement-y",
  "--scroll-area-overflow-x-start",
  "--scroll-area-overflow-x-end",
  "--scroll-area-overflow-y-start",
  "--scroll-area-overflow-y-end",
  "--active-tab-width",
  "--active-tab-left",
]);

const read = (): Variable[] =>
  [source, ...(process.env.TOKENS_EXTRA ?? "").split(",").filter(Boolean)]
    .flatMap((file) => readFileSync(file, "utf8").trim().split("\n").filter((line) => line && !line.startsWith("collection\t")))
    .map((line) => {
      const [collection, name, type, light, dark, code] = line.split("\t");
      return { collection, name, type, light, dark: dark || light, code } as Variable;
    });

const variables = read();
const byName = new Map(variables.map((v) => [v.name, v]));
const cssName = (name: string) => `--${name.replaceAll("/", "-")}`;
const isAlias = (value: string) => value.startsWith("{") && value.endsWith("}");
const aliasOf = (value: string) => {
  const found = byName.get(value.slice(1, -1));
  if (!found) throw new Error(`${value} points at no variable`);
  return found;
};
const step = (px: number) => (px === 1 ? "px" : String(px / 4).replace(".", "_"));
const SHADOW_PART = /\/(x|y|blur|spread|color)$/;
const shadowRoot = (name: string) => {
  const layer = name.replace(SHADOW_PART, "");
  return /\/\d+$/.test(layer) ? layer.replace(/\/\d+$/, "") : layer;
};
const isShadowPart = (v: Variable) => SHADOW_PART.test(v.name) && /(^|\/)shadow/.test(v.name);

const unit = (name: string, value: string) => {
  if (/opacity$/.test(name)) return `${value}%`;
  if (/saturation$/.test(name)) return value;
  if (/^duration\//.test(name)) return `${value}ms`;
  return value === "0" ? "0" : `${value}px`;
};

const css = (v: Variable, mode: "light" | "dark"): string => {
  const value = v[mode];
  if (isAlias(value)) {
    const to = aliasOf(value);
    if (to.collection === "Primitives") return to.code || `var(--${to.name.replaceAll("/", "-")})`;
    if (to.collection === "Tokens") return to.code || unit(to.name, to[mode]);
    return `var(${cssName(to.name)})`;
  }
  if (v.type === "COLOR" || v.type === "STRING") return value;
  return unit(v.name, value);
};

const shadow = (root: string, mode: "light" | "dark") => {
  const parts = variables.filter((v) => isShadowPart(v) && shadowRoot(v.name) === root);
  const layers = [...new Set(parts.map((v) => v.name.replace(SHADOW_PART, "")))].sort();
  return layers
    .map((layer) => {
      const part = (key: string, fallback: string) => {
        const v = byName.get(`${layer}/${key}`);
        return v ? css(v, mode) : fallback;
      };
      return `${part("x", "0")} ${part("y", "0")} ${part("blur", "0")} ${part("spread", "0")} ${part("color", "transparent")}`;
    })
    .join(", ");
};

const tailwind = (name: string) => tailwindTheme.match(new RegExp(`^\\s*${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`, "m"))?.[1]?.trim();

export const generate = () => {
  const theme: string[] = [];
  const root: string[] = [];
  const dark: string[] = [];
  for (const v of variables.filter((each) => each.collection === "Primitives" && /^color\//.test(each.name))) {
    const name = cssName(v.name);
    if (!tailwind(name)) theme.push(`  ${name}: ${v.light};`);
  }
  for (const v of variables.filter((each) => each.collection === "Tokens")) {
    const [group, key] = v.name.split("/");
    if (group === "radius" && !["none", "default", "full"].includes(key!)) theme.push(`  --radius-${key}: ${v.light}px;`);
    if (group === "font-size") theme.push(`  --text-${key}: ${v.light}px;`);
    if (group === "blur" && key !== "none") theme.push(`  --blur-${key}: ${v.light}px;`);
    if (group === "ease") theme.push(`  --ease-${key}: ${v.light};`);
    if (group === "duration") root.push(`  --duration-${key}: ${v.light}ms;`);
  }
  for (const key of [...new Set(variables.filter((v) => v.collection === "Tokens" && isShadowPart(v)).map((v) => shadowRoot(v.name)))])
    theme.push(`  ${cssName(key)}: ${shadow(key, "light")};`);
  const scoped = variables.filter((v) => v.collection === "Theme" || v.collection === "Components");
  const roots = new Set<string>();
  for (const v of scoped) {
    if (isShadowPart(v)) {
      roots.add(shadowRoot(v.name));
      continue;
    }
    const light = css(v, "light");
    const night = css(v, "dark");
    root.push(`  ${cssName(v.name)}: ${light};`);
    if (night !== light) dark.push(`  ${cssName(v.name)}: ${night};`);
  }
  for (const key of [...roots].sort()) {
    const light = shadow(key, "light");
    const night = shadow(key, "dark");
    root.push(`  ${cssName(key)}: ${light};`);
    if (night !== light) dark.push(`  ${cssName(key)}: ${night};`);
  }
  return [
    `@theme {\n${theme.join("\n")}\n}`,
    `:root,\n[data-unframed-theme="light"] {\n${root.join("\n")}\n}`,
    `[data-unframed-theme="dark"] {\n${dark.join("\n")}\n}`,
  ].join("\n\n") + "\n";
};

const oklchToHex = (value: string) => {
  const match = value.match(/oklch\(([\d.]+)%\s+([\d.]+|none)\s+([\d.]+|none)\)/);
  if (!match) return undefined;
  const l = Number(match[1]) / 100;
  const c = match[2] === "none" ? 0 : Number(match[2]);
  const h = ((match[3] === "none" ? 0 : Number(match[3])) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((x) => {
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  });
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : files(path);
    return /\.(tsx?|css)$/.test(entry) && !path.endsWith("tokens.css") ? [path] : [];
  });

const scale = (group: string) => new Set(variables.filter((v) => v.collection === "Tokens" && v.name.startsWith(`${group}/`)).map((v) => v.name.slice(group.length + 1).replace("_", ".")));

const SPACING = /^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|translate-x|translate-y|scroll-m|scroll-p|indent)-(.+)$/;
const SIZE = /^(w|h|size|min-w|min-h|max-w|max-h|basis)-(.+)$/;
const NUMBER = /^(\d+(\.5)?|px)$/;
const ARBITRARY_LENGTH = /^\[-?[\d.]+(px|rem)\]$/;

export const check = () => {
  const problems: string[] = [];
  const generated = generate();
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {}
  if (current !== generated) problems.push("src/theme/tokens.css is out of date: run pnpm --filter @unframed/web tokens");
  for (const v of variables.filter((each) => each.collection === "Primitives" && /^color\/[a-z]+\/\d+$/.test(each.name))) {
    const value = tailwind(cssName(v.name));
    const rgb = value && oklchToHex(value);
    if (!rgb) continue;
    const figma = [1, 3, 5].map((i) => parseInt(v.light.slice(i, i + 2), 16));
    if (figma.some((channel, i) => Math.abs(channel - rgb[i]!) > 3)) problems.push(`${v.name}: Figma ${v.light}, Tailwind ${value}`);
  }
  for (const v of variables.filter((each) => each.collection === "Tokens")) {
    const [group, key] = v.name.split("/") as [string, string];
    const px = Number(v.light);
    if (["spacing", "size", "line-height"].includes(group) && key !== "none" && step(px) !== key) problems.push(`${v.name} is ${px}px, which is step ${step(px)}`);
    if (group === "opacity" && key !== "disabled" && String(px) !== key) problems.push(`${v.name} is ${px}`);
  }
  const spacing = scale("spacing");
  const size = scale("size");
  const radius = new Set([...scale("radius")].map((k) => (k === "default" ? "" : k)));
  const text = scale("font-size");
  const leading = scale("line-height");
  const opacity = scale("opacity");
  const shadows = new Set([...variables.filter((v) => v.collection === "Tokens" && isShadowPart(v))].map((v) => shadowRoot(v.name).split("/")[1]));
  const defined = new Set(generated.match(/--[\w-]+(?=:)/g));
  for (const file of [...files(join(web, "src")), ...files(join(web, "design-system"))]) {
    const body = readFileSync(file, "utf8");
    for (const match of body.matchAll(/--[\w-]+(?=\s*:)|["'`]--[\w-]+["'`]/g)) defined.add(match[0].replace(/["'`]/g, ""));
  }
  const allowed = (name: string) =>
    defined.has(name) || RUNTIME.has(name) || tailwind(name) !== undefined || /^--(tw|tl|color|spacing|text|font|radius|shadow|blur|ease|animate|leading|tracking|default|container|breakpoint|diffs|radix|base-ui|visible|unframed)-?/.test(name);
  for (const file of [...files(join(web, "src")), ...files(join(web, "design-system"))]) {
    const body = readFileSync(file, "utf8");
    const where = relative(web, file);
    for (const match of body.matchAll(/var\((--[\w-]+)|[(\[](--[\w-]+)[)\],]/g)) {
      const name = match[1] ?? match[2]!;
      if (!allowed(name)) problems.push(`${where}: ${name} is not a token`);
    }
    if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
    for (const literal of body.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
      for (const raw of literal[2]!.split(/\s+/)) {
        const cls = raw.replace(/^([\w-]+:)*!?/, "").replace(/!$/, "");
        const spacingMatch = cls.match(SPACING);
        const sizeMatch = cls.match(SIZE);
        const [kind, value, scaleSet] = spacingMatch ? ["spacing", spacingMatch[2]!, spacing] : sizeMatch ? ["size", sizeMatch[2]!, size] : [undefined, undefined, undefined];
        if (kind && value && NUMBER.test(value) && value !== "0" && !scaleSet!.has(value)) problems.push(`${where}: ${cls} is off the ${kind} scale`);
        if (kind && value && ARBITRARY_LENGTH.test(value)) problems.push(`${where}: ${cls} is an arbitrary length`);
        const r = cls.match(/^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?(?:-(.+))?$/);
        if (r && !radius.has(r[1] ?? "") && !/^[[(]/.test(r[1] ?? "")) problems.push(`${where}: ${cls} is off the radius scale`);
        const t = cls.match(/^text-(\d?x?s|sm|base|lg|\dxl|xl)$/);
        if (t && !text.has(t[1]!)) problems.push(`${where}: ${cls} is off the font-size scale`);
        const l = cls.match(/^leading-(\d+(\.5)?|none)$/);
        if (l && !leading.has(l[1]!)) problems.push(`${where}: ${cls} is off the line-height scale`);
        const o = cls.match(/^opacity-(\d+)$/) ?? cls.match(/^(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|decoration|caret|placeholder|shadow)-.+\/(\d+)$/);
        if (o && !opacity.has(o[1]!)) problems.push(`${where}: ${cls} is off the opacity scale`);
        const s = cls.match(/^shadow-(2xs|xs|sm|md|lg|xl|2xl)$/);
        if (s && !shadows.has(s[1]!)) problems.push(`${where}: ${cls} is off the shadow scale`);
        const colour = cls.match(/^(bg|text|border|border-[trblxyse]|ring|ring-offset|outline|fill|stroke|divide|from|via|to|decoration|caret|accent|placeholder|shadow|inset-shadow)-([a-z]+(?:-[a-z]+)*)(?:\/[\w()-]+)?$/);
        if (colour && /^(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|highlight|error|info|success|warning|message|code|placeholder|icon-muted|secondary-label|surface-raised|canvas-dot|group-fill|artifact-page|diff)/.test(colour[2]!)) problems.push(`${where}: ${cls} reads a retired theme colour`);
        if (colour && /^(white|black|(slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+)$/.test(colour[2]!)) problems.push(`${where}: ${cls} paints a palette colour instead of a component token`);
      }
    }
  }
  for (const file of [...files(join(web, "src")), ...files(join(web, "design-system"))]) {
    if (file.endsWith("variables.tsv") || file.endsWith("tokens.css")) continue;
    const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "");
    for (const match of body.matchAll(/#[0-9a-fA-F]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g)) {
      if (/^#[0-9a-fA-F]+$/.test(match[0]) && ![3, 4, 6, 8].includes(match[0].length - 1)) continue;
      if (LITERAL_COLOURS[relative(web, file)]?.some((allowed) => match[0].startsWith(allowed))) continue;
      problems.push(`${relative(web, file)}: ${match[0]} is a literal colour`);
    }
  }
  return problems;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = check();
    for (const problem of problems) console.error(problem);
    if (problems.length) {
      console.error(`${problems.length} differences between Figma and code`);
      process.exit(1);
    }
  } else {
    writeFileSync(target, generate());
    console.log(`wrote ${relative(web, target)}`);
  }
}
