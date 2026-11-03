/**
 * The cell editors of the Kit table (spec 19). A cell holds one value of a token in one mode,
 * or the one value of a token for every mode. Each commit is one kit edit; a refusal shows under
 * the cell. Every cell's popover starts with a "Use a token" list of tokens of the same type.
 */
import { EASES, isEaseName, type TextStyle, type Token, type TokenValue } from "@unframed/domain";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";

export const CUBIC_BEZIER = "cubic-bezier";
const BEZIER_DEFAULT = "cubic-bezier(0.25, 0.1, 0.25, 1)";

/** A value as the cell shows it: text for a literal, the alias written as `{path}`. */
export const displayOf = (value: TokenValue | undefined): string => (value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** The token path an alias value names, or undefined for a literal or a text style. */
export const aliasOf = (value: TokenValue | undefined): string | undefined => (typeof value === "string" ? /^\{(.+)\}$/.exec(value)?.[1] : undefined);

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

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map(String).concat(["normal", "bold", "lighter", "bolder"]);
const WEIGHT_ITEMS = FONT_WEIGHTS.map((value) => ({ value, label: value }));

const UNITS = { dimension: ["px", "rem", "em", "%"], duration: ["ms", "s"] } as const;
const NUMBER_UNIT = /^(-?\d*\.?\d+)(px|rem|em|%|ms|s)$/;

/** The alpha of a `#rrggbb` or `#rrggbbaa` colour, and its six-digit hex; undefined for any other text. */
export const parseHex = (text: string): { hex: string; alpha: number } | undefined => {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text.trim());
  if (match === null) return undefined;
  return { hex: `#${match[1]!.toLowerCase()}`, alpha: match[2] === undefined ? 100 : Math.round((parseInt(match[2], 16) / 255) * 100) };
};

/** The CSS text for a hex colour at an opacity: six digits at full opacity, eight digits below it. */
export const colourText = (hex: string, alpha: number): string => (alpha >= 100 ? hex : `${hex}${Math.round((alpha / 100) * 255).toString(16).padStart(2, "0")}`);

/** A text field committed on Enter or blur, abandoned on Escape. It commits only a changed text. */
const TextCell = ({ label, value, swatch, invalid, font = "mono", onCommit }: { readonly label: string; readonly value: string; readonly swatch?: boolean; readonly invalid: boolean; readonly font?: "default" | "mono"; readonly onCommit: (text: string) => void }) => {
  const [draft, setDraft] = useState(value);
  // A value changed elsewhere (a cell's popover) shows at once, so the field never reads a stale value.
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {swatch && <span aria-hidden className="size-4 shrink-0 rounded-sm border" style={{ background: value }} />}
      <Input
        size="sm"
        font={font}
        aria-label={label}
        value={draft}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            keepEscapeInField(event);
            setDraft(value);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
};

/** A number and a unit, for a dimension or a duration. The unit commits at once; the number on Enter or blur. */
const NumberUnitCell = ({ label, type, number, unit, onCommit }: { readonly label: string; readonly type: "dimension" | "duration"; readonly number: string; readonly unit: string; readonly onCommit: (text: string) => void }) => {
  const [draft, setDraft] = useState(number);
  const commit = () => {
    if (draft !== number) onCommit(`${draft}${unit}`);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        size="sm"
        type="number"
        font="mono"
        aria-label={`${label} number`}
        value={draft}
        className="w-24"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            keepEscapeInField(event);
            setDraft(number);
          }
        }}
        onBlur={commit}
      />
      <Select items={UNITS[type].map((item) => ({ value: item, label: item }))} value={unit} onValueChange={(next) => next && onCommit(`${number}${next as string}`)}>
        <SelectTrigger aria-label={`${label} unit`} className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {UNITS[type].map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
};

/** An easing cell: the 31 GSAP eases with their curves, and a cubic bezier entry, which keeps its own text field. */
const EaseCell = ({ label, value, invalid, onChoose, onText }: { readonly label: string; readonly value: string; readonly invalid: boolean; readonly onChoose: (next: string) => void; readonly onText: (text: string) => void }) => {
  const bezier = isBezierText(value);
  const current = isEaseName(value) ? value : bezier ? CUBIC_BEZIER : undefined;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Select
        items={EASE_ITEMS}
        value={current ?? null}
        onValueChange={(next) => {
          if (!next) return;
          onChoose(next === CUBIC_BEZIER ? BEZIER_DEFAULT : (next as string));
        }}
      >
        <SelectTrigger aria-label={`${label} value`} aria-invalid={invalid || undefined}>
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
      {bezier && <TextCell label={`${label} cubic bezier`} value={value} invalid={invalid} onCommit={onText} />}
    </div>
  );
};

/** A font weight: a select of 100 to 900 and the keywords. */
const WeightCell = ({ label, value, onChoose }: { readonly label: string; readonly value: string; readonly onChoose: (next: string) => void }) => (
  <Select items={WEIGHT_ITEMS} value={value} onValueChange={(next) => next && onChoose(next as string)}>
    <SelectTrigger aria-label={`${label} weight`} className="min-w-0 flex-1">
      <SelectValue />
    </SelectTrigger>
    <SelectPopup alignItemWithTrigger={false}>
      {WEIGHT_ITEMS.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </SelectPopup>
  </Select>
);

/** The "Use a token" list at the top of a popover: the tokens of the same type, the cell's own excluded. */
const AliasList = ({ token, tokens, onUse }: { readonly token: Token; readonly tokens: ReadonlyArray<Token>; readonly onUse: (path: string) => void }) => {
  const choices = tokens.filter((candidate) => candidate.type === token.type && candidate.path !== token.path);
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">Use a token</span>
      {choices.length === 0 ? (
        <span className="text-xs text-muted-foreground">No other {token.type} tokens.</span>
      ) : (
        choices.map((choice) => (
          <Button key={choice.path} variant="ghost" size="sm" className="justify-start" onClick={() => onUse(choice.path)}>
            <span className="font-mono">{choice.path}</span>
          </Button>
        ))
      )}
    </div>
  );
};

/** A popover on a cell: its trigger, then the alias list, then the cell's own fields. */
const CellPopover = ({ label, token, tokens, trigger, onUse, children }: { readonly label: string; readonly token: Token; readonly tokens: ReadonlyArray<Token>; readonly trigger: ReactNode; readonly onUse: (path: string) => void; readonly children?: ReactNode }) => (
  <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="sm" className="min-w-0 shrink-0" aria-label={`Options ${label}`} />}>{trigger}</PopoverTrigger>
    <PopoverPopup side="bottom" align="start" sideOffset={6} className="w-72">
      <div className="grid gap-3">
        <AliasList token={token} tokens={tokens} onUse={onUse} />
        {children}
      </div>
    </PopoverPopup>
  </Popover>
);

/** A colour's popover fields: the colour input, the CSS text and the opacity. The colour input commits when the drag ends. */
const ColourFields = ({ label, text, invalid, onCommit }: { readonly label: string; readonly text: string; readonly invalid: boolean; readonly onCommit: (text: string) => void }) => {
  const parsed = parseHex(text);
  const [dragging, setDragging] = useState<string>();
  const [opacity, setOpacity] = useState<string>();
  const alpha = parsed?.alpha ?? 100;
  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-xs">
        Colour
        <Input
          size="sm"
          type="color"
          aria-label={`${label} colour`}
          value={dragging ?? parsed?.hex ?? "#000000"}
          className="w-12"
          onChange={(event) => setDragging(event.currentTarget.value)}
          onBlur={() => {
            if (dragging !== undefined) onCommit(colourText(dragging, alpha));
            setDragging(undefined);
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        Opacity
        <Input
          size="sm"
          type="number"
          aria-label={`${label} opacity`}
          disabled={parsed === undefined}
          value={opacity ?? String(alpha)}
          className="w-24"
          onChange={(event) => setOpacity(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => {
            if (opacity === undefined || parsed === undefined) return setOpacity(undefined);
            const next = Math.min(100, Math.max(0, Math.round(Number(opacity))));
            setOpacity(undefined);
            if (Number.isFinite(next) && next !== alpha) onCommit(colourText(parsed.hex, next));
          }}
        />
        %
      </label>
      <TextCell label={`${label} CSS text`} value={text} invalid={invalid} font="mono" onCommit={onCommit} />
    </div>
  );
};

/** A text style's popover fields: family, size, weight, line height and letter spacing, each committed on its own. */
const STYLE_FIELDS: ReadonlyArray<keyof TextStyle> = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"];

const TextStyleFields = ({ label, style, invalid, onCommit }: { readonly label: string; readonly style: TextStyle; readonly invalid: boolean; readonly onCommit: (next: TextStyle) => void }) => (
  <div className="grid gap-2">
    {STYLE_FIELDS.map((field) => (
      <label key={field} className="grid gap-1 text-xs">
        {field}
        <TextCell
          label={`${label} text style ${field}`}
          value={String(style[field])}
          invalid={invalid}
          onCommit={(text) => onCommit({ ...style, [field]: (field === "fontWeight" && /^\d+$/.test(text)) || (field === "lineHeight" && /^\d*\.?\d+$/.test(text)) ? Number(text) : text })}
        />
      </label>
    ))}
  </div>
);

/** One cell: the editor for its type, its popover, and the alias chip when the value is an alias. */
export const ValueCell = ({ token, tokens, label, value, onCommit }: { readonly token: Token; readonly tokens: ReadonlyArray<Token>; readonly label: string; readonly value: TokenValue | undefined; readonly onCommit: (next: TokenValue) => string | undefined }) => {
  const [problem, setProblem] = useState<string>();
  const commit = (next: TokenValue) => setProblem(onCommit(next));
  const text = displayOf(value);
  const alias = aliasOf(value);
  const invalid = problem !== undefined;
  const useToken = (path: string) => commit(`{${path}}`);
  const plainText = (next: string) => commit(valueOf(token, next));

  const cell = (() => {
    if (token.type === "easing") {
      return <EaseCell label={label} value={text} invalid={invalid} onChoose={(next) => commit(next)} onText={plainText} />;
    }
    if (token.type === "textStyle") {
      const style = typeof value === "object" ? value : undefined;
      return (
        <CellPopover label={label} token={token} tokens={tokens} onUse={useToken} trigger={<span className="truncate font-mono text-xs">{style === undefined ? text : `${style.fontSize} ${style.fontWeight} ${style.fontFamily}`}</span>}>
          {style !== undefined && <TextStyleFields label={label} style={style} invalid={invalid} onCommit={(next) => commit(next)} />}
        </CellPopover>
      );
    }
    if (alias === undefined && (token.type === "dimension" || token.type === "duration")) {
      const match = NUMBER_UNIT.exec(text);
      if (match !== null && (UNITS[token.type] as readonly string[]).includes(match[2]!)) {
        return <NumberUnitCell label={label} type={token.type} number={match[1]!} unit={match[2]!} onCommit={plainText} />;
      }
    }
    if (alias === undefined && token.type === "fontWeight") {
      return <WeightCell label={label} value={text} onChoose={(next) => commit(valueOf(token, next))} />;
    }
    return <TextCell label={label} value={text} swatch={token.type === "color"} invalid={invalid} onCommit={plainText} />;
  })();

  const showsOwnPopover = token.type === "textStyle";
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-1">
        {alias !== undefined && (
          <span data-alias={alias} className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {alias}
          </span>
        )}
        {cell}
        {!showsOwnPopover && (
          <CellPopover label={label} token={token} tokens={tokens} onUse={useToken} trigger={<EllipsisIcon aria-hidden />}>
            {token.type === "color" && alias === undefined && <ColourFields label={label} text={text} invalid={invalid} onCommit={plainText} />}
          </CellPopover>
        )}
      </div>
      {problem !== undefined && (
        <span role="alert" className="text-xs text-destructive">
          {problem}
        </span>
      )}
    </div>
  );
};
