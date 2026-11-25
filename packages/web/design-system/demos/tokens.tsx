/** Every variable the Figma export defines in the Tokens, Theme and Components collections, with its CSS name and its value in the current scheme. */
import { useEffect, useState } from "react";
import variables from "~/theme/variables.tsv?raw";
import { Section } from "../frame.tsx";

type Kind = "colour" | "radius" | "shadow" | "text" | "value";
type Token = { readonly path: string; readonly css: string; readonly expression: string; readonly kind: Kind };

const COLLECTIONS = ["Tokens", "Theme", "Components"] as const;
type Collection = (typeof COLLECTIONS)[number];

const SHADOW_PART = /\/(x|y|blur|spread|color)$/;
const isShadowPart = (name: string) => SHADOW_PART.test(name) && /(^|\/)shadow/.test(name);
const shadowRoot = (name: string) => {
  const layer = name.replace(SHADOW_PART, "");
  return /\/\d+$/.test(layer) ? layer.replace(/\/\d+$/, "") : layer;
};
const cssName = (name: string) => `--${name.replaceAll("/", "-")}`;

const kindOf = (name: string, type: string): Kind => {
  if (type === "COLOR") return "colour";
  if (/(^|\/)radius/.test(name)) return "radius";
  if (/^font-|^line-height\//.test(name) || type === "STRING") return "text";
  return "value";
};

const rows = variables
  .trim()
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("collection\t"))
  .map((line) => line.split("\t") as [string, string, string, string, string, string?]);

const collect = (collection: Collection) => {
  const groups = new Map<string, Token[]>();
  const seen = new Set<string>();
  for (const [from, name, type, , , code = ""] of rows) {
    if (from !== collection) continue;
    const shadow = isShadowPart(name);
    const path = shadow ? shadowRoot(name) : name;
    if (seen.has(path)) continue;
    seen.add(path);
    const own = cssName(path);
    const fromCode = collection === "Tokens" && !shadow && code !== "" ? code : undefined;
    const css = fromCode === undefined ? own : (/^var\((--[\w-]+)\)$/.exec(fromCode)?.[1] ?? fromCode);
    const expression = fromCode ?? `var(${own})`;
    const group = path.split("/")[0]!;
    groups.set(group, [...(groups.get(group) ?? []), { path, css, expression, kind: shadow ? "shadow" : kindOf(name, type) }]);
  }
  return [...groups].map(([group, tokens]) => ({ group, tokens }));
};

const SECTIONS = COLLECTIONS.map((collection) => ({ collection, groups: collect(collection) }));
const ALL = SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.tokens));

/** The live value of each expression, read off a probe and re-read when the scheme flips. */
const useValues = () => {
  const read = (): Record<string, string> => {
    const probe = document.createElement("div");
    probe.hidden = true;
    ALL.forEach((token, index) => probe.style.setProperty(`--catalogue-probe-${index}`, token.expression));
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const values = Object.fromEntries(ALL.map((token, index) => [token.path, style.getPropertyValue(`--catalogue-probe-${index}`).trim()]));
    probe.remove();
    return values;
  };
  const [values, setValues] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setValues(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-unframed-theme"] });
    return () => observer.disconnect();
  }, []);
  return values;
};

const emitted = (value: string | undefined) => value !== undefined && value !== "" && !/var\(--[\w-]+\)/.test(value);

export default function Tokens() {
  const values = useValues();
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 text-(--catalogue-description) text-sm">
        From variables.tsv, the Figma export. The page follows the system scheme; switch the system to dark to see the dark values.
      </p>
      {SECTIONS.map((section) => (
        <Section key={section.collection} title={`${section.collection} (${section.groups.reduce((sum, group) => sum + group.tokens.length, 0)})`}>
          {section.groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-2">
              <h4 className="m-0 font-medium font-mono text-(--catalogue-description) text-xs">{group.group}</h4>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--catalogue-token-width),1fr))] gap-3">
                {group.tokens.map((token) => (
                  <div key={token.path} className="flex items-center gap-3" data-token={token.css}>
                    <Sample kind={token.kind} expression={token.expression} css={token.css} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs">{token.css}</span>
                      <span className="truncate font-mono text-(--catalogue-description) text-xs" title={values[token.path]}>
                        {emitted(values[token.path]) ? values[token.path] : "not emitted: no class uses it yet"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>
      ))}
    </div>
  );
}

const Sample = ({ kind, expression, css }: { readonly kind: Kind; readonly expression: string; readonly css: string }) => {
  if (kind === "radius") return <div className="size-9 shrink-0 border-2 border-(--catalogue-sample-border)/(--catalogue-sample-border-opacity) bg-(--catalogue-sample-surface)" style={{ borderRadius: expression }} />;
  if (kind === "shadow") return <div className="size-9 shrink-0 rounded-md bg-(--catalogue-shadow-sample-surface)" style={{ boxShadow: expression }} />;
  if (kind === "text") return <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-(--catalogue-swatch-border) text-sm" style={css.startsWith("--font") ? { fontFamily: expression } : {}}>Aa</div>;
  if (kind === "value") return <div className="size-9 shrink-0 rounded-md border border-dashed border-(--catalogue-swatch-border)" />;
  return <div className="size-9 shrink-0 rounded-md border border-(--catalogue-swatch-border)" style={{ background: expression }} />;
};
