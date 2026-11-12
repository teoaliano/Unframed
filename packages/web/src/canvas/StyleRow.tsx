import { ANNOTATION_SWATCHES, cssFamily, shapeDesignOf, styleControlsFor, type DesignKey, type StyleControl } from "@unframed/domain";
import { AlignCenter, AlignLeft, AlignRight, Bold, SlidersHorizontal, Spline } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useEditor, type Editor } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { NumberField, NumberFieldGroup, NumberFieldInput, NumberFieldStepper } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { Tip } from "../chrome/ui.tsx";
import { MIXED, numberOf } from "../design/controls.tsx";
import { DialColour, DialScope } from "./dialLazy.tsx";
import { useDesignPanelOpen } from "./designPanelPref.ts";
import { ALIGN_OPTIONS, alignChange, alignOf, designValue, fillChange, fillOf, FONT_NAMES, fontChange, fontOf, props, shared, toHex, SIZE_RANGE, STROKE_WIDTH_RANGE, weightOf, writeDesign, type DesignChange, type DesignTarget, type Subject } from "./designTarget.ts";

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

interface ColourView {
  readonly value: string;
  readonly shown: string;
  readonly mixed: boolean;
  readonly none?: boolean;
}

const canvasFocus = (editor: Editor) => (closeType: string) => (closeType === "keyboard" ? true : editor.getContainer());

const keepEscape = (editor: Editor) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Escape") editor.markEventAsHandled(event.nativeEvent);
};

const MixedMark = () => <span aria-hidden className="block h-0.5 w-2 rounded-full bg-muted-foreground" />;

const SwatchFace = ({ kind, view }: { readonly kind: "fill" | "stroke" | "text"; readonly view: ColourView }) => {
  const colour = view.mixed || view.none || view.shown === "" ? undefined : view.shown;
  if (kind === "text")
    return (
      <span aria-hidden className="flex flex-col items-center leading-none">
        <span className="text-sm font-semibold">A</span>
        <span className="mt-0.5 h-1 w-3.5 rounded-sm border" style={{ background: colour }} />
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn("flex size-4 items-center justify-center rounded-[4px] border", kind === "stroke" && "border-[3px]")}
      style={kind === "stroke" ? { borderColor: colour } : { background: colour }}
    >
      {view.mixed ? <MixedMark /> : view.none ? <span className="block h-px w-3 rotate-45 bg-destructive" /> : null}
    </span>
  );
};

const StylePopover = ({
  label,
  control,
  trigger,
  children,
}: {
  readonly label: string;
  readonly control: StyleControl;
  readonly trigger: ReactNode;
  readonly children: (close: () => void) => ReactNode;
}) => {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={label} side="top">
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} data-style-control={control} />}>{trigger}</PopoverTrigger>
      </Tip>
      <PopoverPopup side="top" align="center" padding="compact" className="w-fit" aria-label={label} initialFocus={false} finalFocus={canvasFocus(editor)} onKeyDown={keepEscape(editor)}>
        {open && (
          <Suspense fallback={null}>
            <DialScope>{children(() => setOpen(false))}</DialScope>
          </Suspense>
        )}
      </PopoverPopup>
    </Popover>
  );
};

const SwatchButton = ({ name, selected, onClick, children }: { readonly name: string; readonly selected: boolean; readonly onClick: () => void; readonly children: ReactNode }) => (
  <Tip label={name} side="top">
    <Button variant="ghost" size="icon-xs" aria-label={name} aria-pressed={selected} onClick={onClick}>
      <span className={cn("block size-5 rounded-[5px]", selected && "ring-2 ring-primary ring-offset-1 ring-offset-background")}>{children}</span>
    </Button>
  </Tip>
);

const ColourButton = ({
  label,
  kind,
  view,
  allowNone,
  onPick,
}: {
  readonly label: string;
  readonly kind: "fill" | "stroke" | "text";
  readonly view: ColourView;
  readonly allowNone: boolean;
  readonly onPick: (hex: string | null | "none", burst?: boolean) => void;
}) => {
  const current = view.mixed ? undefined : view.value;
  return (
    <StylePopover label={label} control={kind === "text" ? "textColor" : kind} trigger={<SwatchFace kind={kind} view={view} />}>
      {(close) => (
        <>
          <div className="grid grid-cols-[repeat(7,--spacing(6))] gap-1 pb-1.5" role="group" aria-label={`${label} swatches`}>
            <SwatchButton name="Default" selected={!view.mixed && !view.none && current === ""} onClick={() => (onPick(null), close())}>
              <span aria-hidden className="block size-full rounded-[5px] border bg-[linear-gradient(135deg,var(--foreground)_50%,var(--background)_50%)]" />
            </SwatchButton>
            {ANNOTATION_SWATCHES.map((swatch) => (
              <SwatchButton key={swatch.hex} name={swatch.name} selected={current === swatch.hex} onClick={() => (onPick(swatch.hex), close())}>
                <span aria-hidden className="block size-full rounded-[5px]" style={{ background: swatch.hex }} />
              </SwatchButton>
            ))}
            {allowNone && (
              <SwatchButton name="None" selected={view.none === true} onClick={() => (onPick("none"), close())}>
                <span aria-hidden className="relative block size-full rounded-[5px] border">
                  <span className="absolute top-1/2 left-0.5 right-0.5 h-px -rotate-45 bg-destructive" />
                </span>
              </SwatchButton>
            )}
          </div>
          <DialColour label="Custom" value={(current || view.shown || "#000000").slice(0, 7)} onChange={(hex) => /^#[0-9a-f]{6}$/i.test(hex) && hex.toLowerCase() !== current && onPick(hex.toLowerCase(), true)} />
        </>
      )}
    </StylePopover>
  );
};

const StrokeLine = ({ width }: { readonly width: number }) => (
  <span aria-hidden className="flex h-4 w-4 items-center">
    <span className="block w-full rounded-full bg-foreground" style={{ height: Math.max(1, Math.min(width, 8)) / 1.5 + 0.5 }} />
  </span>
);

const toCanvas = (editor: Editor) => {
  editor.getContainer().focus();
};

const StyleNumber = ({
  label,
  control,
  value,
  mixed,
  range,
  leading,
  onCommit,
}: {
  readonly label: string;
  readonly control: StyleControl;
  readonly value: number;
  readonly mixed: boolean;
  readonly range: { readonly min: number; readonly max: number; readonly step: number };
  readonly leading?: ReactNode;
  readonly onCommit: (next: number) => void;
}) => {
  const editor = useEditor();
  const shown = mixed || !Number.isFinite(value) ? null : value;
  const [draft, setDraft] = useState<number | null>(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <NumberField
      size="sm"
      className="w-auto shrink-0"
      value={draft}
      min={range.min}
      max={range.max}
      step={range.step}
      format={{ useGrouping: false, maximumFractionDigits: 1 }}
      onValueChange={setDraft}
      onValueCommitted={(next) => {
        if (next !== null && next !== shown) onCommit(next);
      }}
    >
      <NumberFieldGroup className={mixed ? (leading === undefined ? "w-18" : "w-24") : leading === undefined ? "w-13" : "w-20"} data-style-control={control}>
        {leading}
        <NumberFieldInput
          aria-label={label}
          placeholder={mixed ? MIXED : undefined}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return;
            editor.markEventAsHandled(event.nativeEvent);
            if (event.key === "Escape") setDraft(shown);
            event.currentTarget.blur();
            toCanvas(editor);
          }}
        />
        <NumberFieldStepper />
      </NumberFieldGroup>
    </NumberField>
  );
};

const StyleMenu = ({
  label,
  control,
  icon,
  trigger,
  value,
  options,
  onPick,
}: {
  readonly label: string;
  readonly control: StyleControl;
  readonly icon: boolean;
  readonly trigger: ReactNode;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: ReactNode; readonly style?: CSSProperties }[];
  readonly onPick: (picked: string) => void;
}) => {
  const editor = useEditor();
  return (
    <Menu>
      <Tip label={label} side="top">
        <MenuTrigger render={<Button variant="ghost" size={icon ? "icon-sm" : "sm"} aria-label={label} data-style-control={control} />}>{trigger}</MenuTrigger>
      </Tip>
      <MenuPopup side="top" align="center" sideOffset={8} aria-label={label} finalFocus={canvasFocus(editor)} onKeyDown={keepEscape(editor)}>
        <MenuRadioGroup value={value} onValueChange={(picked) => typeof picked === "string" && picked !== value && onPick(picked)}>
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick style={option.style}>
              <span className="flex w-full items-center justify-between gap-4">
                {option.label}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
};

const FONT_FACES: Readonly<Record<string, string>> = { Draw: "tldraw_draw, sans-serif", Sans: "tldraw_sans, sans-serif", Serif: "tldraw_serif, serif", Mono: "tldraw_mono, monospace" };

const DASH_PATHS: Readonly<Record<string, { readonly d: string; readonly dash?: string }>> = {
  draw: { d: "M1 7C5 3 8 10 12 6S19 3 23 7 29 9 31 5" },
  solid: { d: "M1 6H31" },
  dashed: { d: "M1 6H31", dash: "5 4" },
  dotted: { d: "M2 6H31", dash: "0 4.5" },
};

const DASH_STYLES = [
  { value: "draw", name: "Draw" },
  { value: "solid", name: "Solid" },
  { value: "dashed", name: "Dashed" },
  { value: "dotted", name: "Dotted" },
] as const;

const DashPreview = ({ dash }: { readonly dash: string }) => {
  const path = DASH_PATHS[dash] ?? DASH_PATHS.solid!;
  return (
    <svg aria-hidden width="32" height="12" viewBox="0 0 32 12" fill="none" className="shrink-0">
      <path d={path.d} stroke="currentColor" strokeWidth="2" strokeLinecap={path.dash === "5 4" ? "butt" : "round"} strokeDasharray={path.dash} />
    </svg>
  );
};

const controlFor = (editor: Editor, target: DesignTarget, control: StyleControl): ReactNode => {
  const { subjects } = target;
  const write = (change: DesignChange, burst?: string) => writeDesign(editor, target, change, burst);
  const values = (pick: (subject: Subject) => string) => shared(subjects.map(pick));
  const colourView = (key: DesignKey): ColourView => {
    const set = values((subject) => String(shapeDesignOf(subject.shape.meta)[key] ?? ""));
    const shown = values((subject) => toHex(designValue(editor, subject, key)));
    const mixed = set.mixed || shown.mixed;
    return { value: mixed ? "" : set.value, shown: mixed ? "" : shown.value, mixed };
  };
  const number = (key: DesignKey) => values((subject) => numberOf(String(designValue(editor, subject, key) ?? "")));
  const pickColour = (key: DesignKey) => (hex: string | null | "none", burst?: boolean) => hex !== "none" && write({ design: { [key]: hex } }, burst ? key : undefined);
  switch (control) {
    case "fill": {
      const note = subjects.every((subject) => subject.type === "note");
      const fill = fillOf(editor, subjects);
      const view: ColourView = fill.none || fill.mixed ? { value: "", shown: "", mixed: fill.mixed, none: fill.none } : colourView("fillColor");
      return (
        <ColourButton
          key={control}
          label={note ? "Colour" : "Fill"}
          kind="fill"
          view={view}
          allowNone={!subjects.some((subject) => subject.type === "note")}
          onPick={(hex, burst) => write(hex === "none" ? fillChange(null) : hex === null ? { design: { fillColor: null } } : fillChange(hex), burst ? "fillColor" : undefined)}
        />
      );
    }
    case "stroke":
      return <ColourButton key={control} label="Stroke" kind="stroke" view={colourView("strokeColor")} allowNone={false} onPick={pickColour("strokeColor")} />;
    case "textColor":
      return <ColourButton key={control} label="Text colour" kind="text" view={colourView("textColor")} allowNone={false} onPick={pickColour("textColor")} />;
    case "strokeWidth": {
      const view = number("strokeWidth");
      const width = Number(view.value);
      return (
        <StyleNumber
          key={control}
          label="Stroke width"
          control={control}
          value={width}
          mixed={view.mixed}
          range={STROKE_WIDTH_RANGE}
          leading={
            <span aria-hidden className="flex items-center ps-2.5">
              <StrokeLine width={view.mixed || !Number.isFinite(width) ? 2 : width} />
            </span>
          }
          onCommit={(next) => write({ design: { strokeWidth: next } }, "strokeWidth")}
        />
      );
    }
    case "dash": {
      const view = values((subject) => String(props(subject.shape).dash ?? "draw"));
      return (
        <StyleMenu
          key={control}
          label="Stroke style"
          control={control}
          icon
          trigger={<Spline aria-hidden />}
          value={view.mixed ? "" : view.value}
          options={DASH_STYLES.map((style) => ({
            value: style.value,
            label: (
              <span className="flex items-center gap-2">
                <DashPreview dash={style.value} />
                {style.name}
              </span>
            ),
          }))}
          onPick={(picked) => write({ props: () => ({ dash: picked }) })}
        />
      );
    }
    case "font": {
      const view = values(fontOf);
      const custom = !view.mixed && view.value !== "" && !FONT_NAMES.includes(view.value) ? [view.value] : [];
      return (
        <StyleMenu
          key={control}
          label="Font"
          control={control}
          icon={false}
          trigger={<span className="max-w-20 truncate text-xs">{view.mixed ? MIXED : view.value}</span>}
          value={view.mixed ? "" : view.value}
          options={[...custom, ...FONT_NAMES].map((name) => ({ value: name, label: name, style: { fontFamily: FONT_FACES[name] ?? cssFamily(name) } }))}
          onPick={(picked) => write(fontChange(picked))}
        />
      );
    }
    case "size": {
      const view = number("fontSize");
      return <StyleNumber key={control} label="Size" control={control} value={Number(view.value)} mixed={view.mixed} range={SIZE_RANGE} onCommit={(next) => write({ design: { fontSize: Math.round(next) } }, "fontSize")} />;
    }
    case "bold": {
      const view = values((subject) => (Number(weightOf(designValue(editor, subject, "fontWeight"))) >= 600 ? "bold" : "regular"));
      const pressed = !view.mixed && view.value === "bold";
      return (
        <Tip key={control} label="Bold" side="top">
          <Toggle variant="ghost" size="sm" aria-label="Bold" data-style-control="bold" pressed={pressed} onPressedChange={(next) => write({ design: { fontWeight: next ? "700" : "400" } })}>
            <Bold aria-hidden />
          </Toggle>
        </Tip>
      );
    }
    case "align": {
      const view = values(alignOf);
      const at = ALIGN_OPTIONS.findIndex((option) => !view.mixed && option.value === view.value);
      const current = ALIGN_OPTIONS[Math.max(0, at)]!;
      const next = ALIGN_OPTIONS[at < 0 ? 0 : (at + 1) % ALIGN_OPTIONS.length]!;
      const Icon = ALIGN_ICONS[current.value as keyof typeof ALIGN_ICONS] ?? AlignLeft;
      return (
        <Tip key={control} label={view.mixed ? "Align" : `Align ${current.label.toLowerCase()}`} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Align"
            aria-description={view.mixed ? "Mixed" : current.label}
            data-style-control={control}
            onClick={() => {
              const change = alignChange(next.value);
              if (change !== undefined) write(change);
            }}
          >
            <Icon aria-hidden />
          </Button>
        </Tip>
      );
    }
  }
};

export const useOpenPopupEscape = (ref: RefObject<HTMLElement | null>) => {
  const editor = useEditor();
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && event.target instanceof Element && event.target.closest("[aria-expanded='true'], [data-slot='number-field-input']") !== null) editor.markEventAsHandled(event);
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [editor, ref]);
};

export const StyleControls = ({ target }: { readonly target: DesignTarget }) => {
  const editor = useEditor();
  const controls = styleControlsFor(target.subjects.map((subject) => subject.type));
  return <>{controls.map((control) => controlFor(editor, target, control))}</>;
};

export const DesignPanelToggle = () => {
  const [open, setOpen] = useDesignPanelOpen();
  return (
    <Tip label="Design panel" side="top">
      <Toggle variant="outline" size="sm" aria-label="Design panel" pressed={open} onPressedChange={setOpen}>
        <SlidersHorizontal aria-hidden />
      </Toggle>
    </Tip>
  );
};

export const StyleRow = ({ target }: { readonly target: DesignTarget }) => {
  const ref = useRef<HTMLDivElement>(null);
  useOpenPopupEscape(ref);
  return (
    <div ref={ref} className="flex items-center gap-0.5" role="group" aria-label="Style" data-testid="style-row">
      <StyleControls target={target} />
      <span className="ml-1">
        <DesignPanelToggle />
      </span>
    </div>
  );
};
