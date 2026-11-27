export interface KeyModifiers {
  readonly shift: boolean;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export type DesignCommand =
  | { readonly kind: "escape" }
  | { readonly kind: "delete" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "hide" }
  | { readonly kind: "wrap" }
  | { readonly kind: "move"; readonly by: 1 | -1 }
  | { readonly kind: "opacity"; readonly value: number }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "parent" }
  | { readonly kind: "children" }
  | { readonly kind: "text"; readonly style: "bold" | "italic" | "underline" | "strike" | "larger" | "smaller" | "centre" }
  | { readonly kind: "swallow" };

export interface KeyContext {
  readonly selected: boolean;
  readonly text: boolean;
  readonly axis: "row" | "column" | undefined;
}

const ARROWS: Readonly<Record<string, { readonly axis: "row" | "column"; readonly by: 1 | -1 }>> = {
  ArrowRight: { axis: "row", by: 1 },
  ArrowLeft: { axis: "row", by: -1 },
  ArrowDown: { axis: "column", by: 1 },
  ArrowUp: { axis: "column", by: -1 },
};

export const designCommand = (key: string, modifiers: KeyModifiers, context: KeyContext): DesignCommand | undefined => {
  const command = modifiers.meta || modifiers.ctrl;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (key === "Escape") return { kind: "escape" };
  if (key === "Delete" || key === "Backspace") return context.selected && !command ? { kind: "delete" } : { kind: "swallow" };
  if (command && lower === "z") return modifiers.shift ? { kind: "redo" } : { kind: "undo" };
  if (key === "Enter" && !command) return modifiers.shift ? { kind: "parent" } : { kind: "children" };
  if (!context.selected) return command && ["d", "g", "]", "[", "b", "i", "u"].includes(lower) ? { kind: "swallow" } : undefined;
  if (command && lower === "d") return { kind: "duplicate" };
  if (command && modifiers.shift && lower === "h") return { kind: "hide" };
  if (command && lower === "g") return { kind: "wrap" };
  if (!command && modifiers.shift && lower === "a") return { kind: "wrap" };
  if (command && (key === "]" || key === "}")) return { kind: "move", by: 1 };
  if (command && (key === "[" || key === "{")) return { kind: "move", by: -1 };
  if (command && context.text) {
    if (modifiers.shift && lower === "x") return { kind: "text", style: "strike" };
    if (modifiers.shift && (key === "." || key === ">")) return { kind: "text", style: "larger" };
    if (modifiers.shift && (key === "," || key === "<")) return { kind: "text", style: "smaller" };
    if (modifiers.alt && (lower === "t" || key === "†")) return { kind: "text", style: "centre" };
    if (!modifiers.shift && lower === "b") return { kind: "text", style: "bold" };
    if (!modifiers.shift && lower === "i") return { kind: "text", style: "italic" };
    if (!modifiers.shift && lower === "u") return { kind: "text", style: "underline" };
  }
  if (command && ["b", "i", "u"].includes(lower)) return { kind: "swallow" };
  const arrow = ARROWS[key];
  if (arrow !== undefined && !command) return context.axis === arrow.axis ? { kind: "move", by: arrow.by } : { kind: "swallow" };
  if (!command && !modifiers.alt && /^[0-9]$/.test(key)) return { kind: "opacity", value: key === "0" ? 1 : Number(key) / 10 };
  return undefined;
};
