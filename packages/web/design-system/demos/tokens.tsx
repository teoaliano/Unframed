/** Every custom property the theme stylesheets define, grouped, with its value in the current scheme. */
import { useEffect, useState } from "react";
import theme from "~/theme/theme.css?raw";
import { Section } from "../frame.tsx";

const names = [...new Set([...theme.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]!))].filter((name) => !name.startsWith("--tw-") && !name.includes("*"));

const GROUPS: ReadonlyArray<{ title: string; test: (name: string) => boolean; kind: "colour" | "radius" | "shadow" | "text" }> = [
  { title: "Radius", test: (name) => name.includes("radius"), kind: "radius" },
  { title: "Shadows", test: (name) => name.startsWith("--shadow"), kind: "shadow" },
  { title: "Type", test: (name) => name.startsWith("--font") || name.startsWith("--text") || name.startsWith("--leading") || name.startsWith("--tracking"), kind: "text" },
  { title: "Colours", test: () => true, kind: "colour" },
];

const grouped = GROUPS.map((group, index) => ({
  ...group,
  names: names.filter((name) => group.test(name) && !GROUPS.slice(0, index).some((earlier) => earlier.test(name))),
}));

/** The live value, re-read when the scheme flips. */
const useValues = () => {
  const read = () => Object.fromEntries(names.map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()]));
  const [values, setValues] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setValues(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-unframed-theme"] });
    return () => observer.disconnect();
  }, []);
  return values;
};

export default function Tokens() {
  const values = useValues();
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 text-muted-foreground text-sm">
        From theme.css. The page follows the system scheme; switch the system to dark to see the dark values.
      </p>
      {grouped.map((group) => (
        <Section key={group.title} title={`${group.title} (${group.names.length})`}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {group.names.map((name) => (
              <div key={name} className="flex items-center gap-3" data-token={name}>
                <Sample kind={group.kind} name={name} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{name}</span>
                  <span className="truncate font-mono text-muted-foreground text-xs" title={values[name]}>
                    {values[name] || "not emitted: no class uses it yet"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

const Sample = ({ kind, name }: { readonly kind: "colour" | "radius" | "shadow" | "text"; readonly name: string }) => {
  const token = `var(${name})`;
  if (kind === "radius") return <div className="size-9 shrink-0 border-2 border-foreground/40 bg-muted" style={{ borderRadius: token }} />;
  if (kind === "shadow") return <div className="size-9 shrink-0 rounded-md bg-card" style={{ boxShadow: token }} />;
  if (kind === "text") return <div className="flex size-9 shrink-0 items-center justify-center rounded-md border text-sm" style={name.startsWith("--font") ? { fontFamily: token } : {}}>Aa</div>;
  return <div className="size-9 shrink-0 rounded-md border" style={{ background: token }} />;
};
