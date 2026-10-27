/**
 * The cell editors of the Kit table (spec 19). A cell holds one value of a token in one mode,
 * or the one value of a token for every mode. Each commit is one kit edit; a refusal shows
 * under the cell.
 */
import { EASES, isEaseName, type Token, type TokenValue } from "@unframed/domain";
import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";

export const CUBIC_BEZIER = "cubic-bezier";
const BEZIER_DEFAULT = "cubic-bezier(0.25, 0.1, 0.25, 1)";

/** A value as the cell shows it: text for a literal, the alias written as `{path}`. */
export const displayOf = (value: TokenValue | undefined): string => (value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** Esc abandons the field it is typed in; it does not also close the dialog around it. */
export const keepEscapeInField = (event: { stopPropagation: () => void; nativeEvent: Event }) => {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
};

/** A cubic bezier written as CSS text. */
const isBezierText = (value: string): boolean => /^cubic-bezier\(/.test(value);

/** What the text the person typed means as a stored value: a number for a plain font weight, otherwise the text. */
export const valueOf = (token: Pick<Token, "type">, text: string): TokenValue => (token.type === "fontWeight" && /^\d+$/.test(text) ? Number(text) : text);

/** A curve of 24 samples, as a small SVG line. */
const Curve = ({ samples }: { readonly samples: ReadonlyArray<number> }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
    <polyline points={samples.map((y, index) => `${(index / (samples.length - 1)) * 22 + 1},${23 - Math.min(Math.max(y, -0.2), 1.2) * 20}`).join(" ")} />
  </svg>
);

const EASE_ITEMS = [
  ...EASES.map((ease) => ({ value: ease.name, label: ease.label, samples: ease.samples })),
  { value: CUBIC_BEZIER, label: "Cubic bezier", samples: undefined },
];

/** An easing cell: the 31 GSAP eases with their curves, and a cubic bezier entry, which keeps its own text field. */
const EaseCell = ({ label, value, onCommit }: { readonly label: string; readonly value: string; readonly onCommit: (next: string) => string | undefined }) => {
  const [problem, setProblem] = useState<string>();
  const bezier = isBezierText(value);
  const current = isEaseName(value) ? value : bezier ? CUBIC_BEZIER : undefined;
  const choose = (next: string) => {
    const stored = next === CUBIC_BEZIER ? BEZIER_DEFAULT : next;
    setProblem(onCommit(stored));
  };
  return (
    <div className="grid gap-1">
      <Select items={EASE_ITEMS} value={current ?? null} onValueChange={(next) => next && choose(next as string)}>
        <SelectTrigger aria-label={`${label} value`}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {EASE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.samples !== undefined && <Curve samples={item.samples} />}
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {bezier && <TextCell label={`${label} cubic bezier`} value={value} onCommit={onCommit} />}
      {problem !== undefined && <span role="alert" className="text-xs text-destructive">{problem}</span>}
    </div>
  );
};

/** A text cell: committed on Enter or on blur, abandoned on Escape. */
const TextCell = ({ label, value, swatch, onCommit }: { readonly label: string; readonly value: string; readonly swatch?: boolean; readonly onCommit: (next: string) => string | undefined }) => {
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string>();
  const commit = () => {
    if (draft === value) return setProblem(undefined);
    setProblem(onCommit(draft));
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      {swatch && <span aria-hidden className="size-4 shrink-0 rounded-sm border" style={{ background: value }} />}
      <Input
        size="sm"
        font="mono"
        aria-label={label}
        value={draft}
        aria-invalid={problem !== undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            keepEscapeInField(event);
            setDraft(value);
            setProblem(undefined);
          }
        }}
        onBlur={commit}
      />
      {problem !== undefined && <span role="alert" className="text-xs text-destructive">{problem}</span>}
    </div>
  );
};

/** One cell: an easing, or a text field with a colour swatch for colours. A text style is read here, not edited yet. */
export const ValueCell = ({ token, label, value, onCommit }: { readonly token: Token; readonly label: string; readonly value: TokenValue | undefined; readonly onCommit: (next: TokenValue) => string | undefined }) => {
  if (token.type === "easing") return <EaseCell label={label} value={displayOf(value)} onCommit={(next) => onCommit(next)} />;
  if (token.type === "textStyle") return <span className="text-xs text-muted-foreground">{displayOf(value)}</span>;
  return <TextCell label={label} value={displayOf(value)} swatch={token.type === "color"} onCommit={(next) => onCommit(valueOf(token, next))} />;
};
