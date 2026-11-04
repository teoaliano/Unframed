
export interface OkColour {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

export interface Length {
  readonly value: number;
  readonly unit: "px" | "rem" | "em" | "%";
}

const NAMED: Record<string, readonly [number, number, number]> = {};
const NAMED_LIST = `aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32`.split(" ");
for (let i = 0; i < NAMED_LIST.length; i += 2) {
  const hex = NAMED_LIST[i + 1]!;
  NAMED[NAMED_LIST[i]!] = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const srgbToOk = (r: number, g: number, b: number): [number, number, number] => {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
};

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

const functionArgs = (text: string, name: string): { parts: string[]; alpha?: string } | null => {
  const match = new RegExp(`^${name}\\((.*)\\)$`, "i").exec(text.trim());
  if (!match) return null;
  const [body, alpha] = match[1]!.split("/").map((part) => part.trim()) as [string, string | undefined];
  const parts = body.split(/[\s,]+/).filter((part) => part !== "");
  if (alpha !== undefined) return { parts, alpha };
  return { parts };
};

const percentOr = (text: string, scale: number): number | undefined => {
  if (text.endsWith("%")) {
    const n = Number(text.slice(0, -1));
    return NUMBER.test(text.slice(0, -1)) ? (n / 100) * scale : undefined;
  }
  return NUMBER.test(text) ? Number(text) : undefined;
};

const alphaOf = (text: string | undefined): number | undefined => {
  if (text === undefined) return 1;
  return percentOr(text, 1);
};

const fromRgb = (r: number, g: number, b: number, alpha: number): OkColour => {
  const [l, a, bb] = srgbToOk(r, g, b);
  return { l, a, b: bb, alpha };
};

export const parseColour = (text: string): OkColour | null => {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return fromRgb(channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) : 1);
  }
  const rgb = functionArgs(value, "rgba?");
  if (rgb) {
    if (rgb.parts.length !== 3) return null;
    const channels = rgb.parts.map((part) => percentOr(part, 255));
    const alpha = alphaOf(rgb.alpha);
    if (channels.some((c) => c === undefined) || alpha === undefined) return null;
    return fromRgb(channels[0]! / 255, channels[1]! / 255, channels[2]! / 255, alpha);
  }
  const hsl = functionArgs(value, "hsla?");
  if (hsl) {
    if (hsl.parts.length !== 3) return null;
    const hue = Number(hsl.parts[0]!.replace(/deg$/, ""));
    const sat = percentOr(hsl.parts[1]!, 1);
    const light = percentOr(hsl.parts[2]!, 1);
    const alpha = alphaOf(hsl.alpha);
    if (!Number.isFinite(hue) || sat === undefined || light === undefined || alpha === undefined) return null;
    const [r, g, b] = hslToRgb(hue, sat, light);
    return fromRgb(r, g, b, alpha);
  }
  const oklch = functionArgs(value, "oklch");
  if (oklch) {
    if (oklch.parts.length !== 3) return null;
    const light = percentOr(oklch.parts[0]!, 1);
    const chroma = percentOr(oklch.parts[1]!, 0.4);
    const hue = Number(oklch.parts[2]!.replace(/deg$/, ""));
    const alpha = alphaOf(oklch.alpha);
    if (light === undefined || chroma === undefined || !Number.isFinite(hue) || alpha === undefined) return null;
    const radians = (hue * Math.PI) / 180;
    return { l: light, a: chroma * Math.cos(radians), b: chroma * Math.sin(radians), alpha };
  }
  const lower = value.toLowerCase();
  if (lower === "transparent") return { l: 0, a: 0, b: 0, alpha: 0 };
  const named = NAMED[lower];
  if (named) return fromRgb(named[0] / 255, named[1] / 255, named[2] / 255, 1);
  return null;
};

export const colourDistance = (x: OkColour, y: OkColour): number => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b) * 100;

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(px|rem|em|%)$/i;

export const parseLength = (text: string): Length | null => {
  const value = text.trim();
  if (value === "0") return { value: 0, unit: "px" };
  const match = LENGTH.exec(value);
  if (!match) return null;
  return { value: Number(match[1]), unit: match[2]!.toLowerCase() as Length["unit"] };
};

export const lengthPx = (length: Length): number | undefined => {
  if (length.unit === "%") return undefined;
  return length.unit === "rem" || length.unit === "em" ? length.value * 16 : length.value;
};

export const parseTime = (text: string): number | null => {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/i.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return match[2]!.toLowerCase() === "s" ? n * 1000 : n;
};

const WEIGHT_KEYWORDS = ["normal", "bold", "lighter", "bolder"];

export const parseWeight = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 && value <= 1000;
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (WEIGHT_KEYWORDS.includes(text)) return true;
  return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 1000;
};

export const weightNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "normal") return 400;
  if (text === "bold") return 700;
  return /^\d+$/.test(text) ? Number(text) : undefined;
};

export const parseBezier = (text: string): [number, number, number, number] | null => {
  const match = /^cubic-bezier\(\s*([^,)]+),\s*([^,)]+),\s*([^,)]+),\s*([^,)]+)\)$/i.exec(text.trim());
  if (!match) return null;
  const numbers = match.slice(1).map((part) => (NUMBER.test(part!.trim()) ? Number(part!.trim()) : NaN));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  return [x1, y1, x2, y2];
};

export const normaliseShadow = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([,()])\s*/g, "$1")
    .replace(/(^|[^\d.])0(px|rem|em|%)?(?![\d.])/g, (_match, before: string) => `${before}0`);

const quotesBalance = (text: string): boolean => (text.match(/"/g)?.length ?? 0) % 2 === 0 && (text.match(/'/g)?.length ?? 0) % 2 === 0;

export const isShadow = (text: string): boolean => {
  const value = text.trim();
  if (value === "" || /[;{}<>\\]|\/\*|\*\//.test(value) || !quotesBalance(value)) return false;
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0 && /(^|\s)-?(\d+\.?\d*|\.\d+)(px|rem|em)?\s+-?(\d+\.?\d*|\.\d+)(px|rem|em)?/.test(value);
};

export const isFontFamily = (text: string): boolean => {
  const value = text.trim();
  return value !== "" && !/[;{}<>\\@\r\n]|\/\*|\*\/|url\(/i.test(value) && quotesBalance(value);
};

export const firstFamily = (text: string): string => {
  const first = text.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
};
