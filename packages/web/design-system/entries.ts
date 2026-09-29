/**
 * The catalogue's menu. Every file in the kit folder is an entry on its own, so a component
 * added to the kit shows up here before anyone writes its demo. The app's own recipes are
 * listed by hand: they are the shared looks outside the kit.
 */
import type { ComponentType } from "react";
import { modulesUnder } from "./source.ts";

export interface Entry {
  readonly id: string;
  readonly title: string;
  readonly group: "Foundations" | "Kit components" | "Unframed recipes";
  /** The module the entry documents, from the package root. */
  readonly module?: string;
  readonly summary?: string;
}

const RECIPES: ReadonlyArray<Omit<Entry, "group">> = [
  { id: "message-action", title: "Message action", module: "/src/chrome/MessageAction.tsx", summary: "The composer's send, stop and labelled pill buttons, from t3code." },
  { id: "corner-card", title: "Corner card and Tip", module: "/src/chrome/ui.tsx", summary: "The glass card the canvas chrome sits in, and the kit tooltip wrapper." },
  { id: "listbox", title: "Listbox", module: "/src/chrome/listbox.ts", summary: "The popup and row look of the mention, slash and chat search menus." },
  { id: "composer-surface", title: "Composer surface", module: "/src/chrome/composerSurface.ts", summary: "The glass fill the Generate and Agent composers share." },
  { id: "hue", title: "Label hues", module: "/src/chrome/hue.ts", summary: "The tints for provider tokens, library chips and role badges." },
  { id: "shape-looks", title: "Shape looks", module: "/src/canvas/shapes/looks.ts", summary: "Shape labels, media cards and artifact cards on the canvas." },
];

const title = (file: string) =>
  file
    .split("-")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

export const ENTRIES: readonly Entry[] = [
  { id: "tokens", title: "Tokens", group: "Foundations", summary: "Every custom property the theme defines, resolved in the current scheme." },
  ...modulesUnder("/src/components/ui/").map((module): Entry => {
    const file = module.slice("/src/components/ui/".length, -".tsx".length);
    return { id: file, title: title(file), group: "Kit components", module };
  }),
  ...RECIPES.map((recipe): Entry => ({ ...recipe, group: "Unframed recipes" })),
];

/** Each entry's demo, by id: a file in ./demos named after the entry. */
export const DEMOS: Readonly<Record<string, ComponentType>> = Object.fromEntries(
  Object.entries(import.meta.glob<{ default: ComponentType }>("./demos/*.tsx", { eager: true })).map(([path, module]) => [path.slice("./demos/".length, -".tsx".length), module.default]),
);
