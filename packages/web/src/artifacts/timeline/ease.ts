/**
 * The ease picker's choices (spec 21, The ease picker): spec 19's 31 catalogue eases with their curves, the ease the file
 * writes as it is, the kit's easing tokens, and, when a parameter sets the ease, only that parameter's options. Pure, so
 * the picker only draws what this returns.
 */
import { EASES, EASE_NAMES, easeLabel, parseBezier, resolve, type Kit } from "@unframed/domain";

/** An ease value as the timeline writes it: a GSAP name (or any text the file holds), or a kit easing token. */
export type EaseValue = string | { readonly token: string };

export interface EaseChoice {
  readonly key: string;
  readonly label: string;
  readonly value: EaseValue;
  /** The curve's 24 samples, or null when the ease has no curve the picker can draw. */
  readonly samples: readonly number[] | null;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly title: string | undefined;
  readonly group: "written" | "catalogue" | "kit";
}

/** The ease a tween is written with: null means GSAP's default. */
export const DEFAULT_EASE = "power1.out";

const SAMPLE_COUNT = 24;

/** The curve of a cubic bezier at 24 evenly spaced progress values: its y at each x, found by bisection. */
export const bezierSamples = ([x1, y1, x2, y2]: readonly [number, number, number, number]): number[] => {
  const coordinate = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const progress = i / (SAMPLE_COUNT - 1);
    let low = 0;
    let high = 1;
    for (let step = 0; step < 40; step++) {
      const mid = (low + high) / 2;
      if (coordinate(mid, x1, x2) < progress) low = mid;
      else high = mid;
    }
    samples.push(coordinate((low + high) / 2, y1, y2));
  }
  return samples;
};

/** The curve a kit easing token draws: a catalogue ease's samples, or a cubic bezier's. Null otherwise. */
export const curveOfText = (text: string): number[] | null => {
  const catalogue = EASES.find((ease) => ease.name === text.trim());
  if (catalogue) return [...catalogue.samples];
  const bezier = parseBezier(text);
  return bezier ? bezierSamples(bezier) : null;
};

/** The kit's easing tokens with the value each takes in the artifact's mode. */
export const kitEasings = (kit: Kit | null, mode: string | undefined): Array<{ readonly path: string; readonly value: string }> =>
  (kit?.tokens ?? []).flatMap((token) => {
    if (token.type !== "easing") return [];
    const value = resolve(kit!, token.path, mode);
    return typeof value === "string" ? [{ path: token.path, value }] : [];
  });

const same = (value: EaseValue, other: EaseValue): boolean =>
  typeof value === "string" ? typeof other === "string" && value === other : typeof other === "object" && other.token === value.token;

export interface EaseChoicesInput {
  /** The ease the tween holds now, or null for GSAP's default. */
  readonly written: EaseValue | null;
  /** The kit's easing tokens. */
  readonly tokens: ReadonlyArray<{ readonly path: string; readonly value: string }>;
  /** The options of the select parameter the ease comes from, or null when no parameter sets it. */
  readonly options: readonly string[] | null;
  /** That parameter's path, folders joined with ` › `, which the disabled rows name. */
  readonly parameter?: string;
}

/** The rows the picker lists, in order: as written (when the file names an ease the catalogue does not), the catalogue, then the kit. */
export const easeChoices = ({ written, tokens, options, parameter = "" }: EaseChoicesInput): EaseChoice[] => {
  const current = written ?? DEFAULT_EASE;
  if (options !== null) {
    const names = [...EASE_NAMES, ...options.filter((name) => !EASE_NAMES.includes(name))];
    return names.map((name) => {
      const allowed = options.includes(name);
      return {
        key: name,
        label: easeLabel(name),
        value: name,
        samples: curveOfText(name),
        checked: name === current,
        disabled: !allowed,
        title: allowed ? undefined : `This ease comes from the parameter ${parameter}, which offers only its own options.`,
        group: "catalogue" as const,
      };
    });
  }
  const asWritten: EaseChoice[] =
    typeof current === "string" && !EASE_NAMES.includes(current) && (typeof written !== "object" || written === null)
      ? [{ key: `written:${current}`, label: current, value: current, samples: curveOfText(current), checked: true, disabled: false, title: undefined, group: "written" }]
      : [];
  const catalogue: EaseChoice[] = EASE_NAMES.map((name) => ({
    key: name,
    label: easeLabel(name),
    value: name,
    samples: curveOfText(name),
    checked: typeof written !== "object" || written === null ? name === current : false,
    disabled: false,
    title: undefined,
    group: "catalogue" as const,
  }));
  const kit: EaseChoice[] = tokens.map((token) => ({
    key: `token:${token.path}`,
    label: token.path,
    value: { token: token.path },
    samples: curveOfText(token.value),
    checked: written !== null && typeof written === "object" && same(written, { token: token.path }),
    disabled: false,
    title: undefined,
    group: "kit" as const,
  }));
  return [...asWritten, ...catalogue, ...kit];
};
