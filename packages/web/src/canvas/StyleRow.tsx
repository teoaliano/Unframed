import { ANNOTATION_SWATCHES, shapeDesignOf, STROKE_WIDTH_PRESETS, strokeWidthPreset, styleControlsFor, type DesignKey, type StyleControl } from "@unframed/domain";
import { AlignCenter, AlignLeft, AlignRight, Bold, SlidersHorizontal, Spline } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useEditor, type Editor } from "tldraw";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { Tip } from "../chrome/ui.tsx";
import { MIXED, NumberControl, numberOf } from "../design/controls.tsx";
import { useDesignPanelOpen } from "./designPanelPref.ts";
import { alignChange, alignOf, DASHES, designValue, fillChange, fillOf, FONT_NAMES, fontChange, fontOf, props, shared, toHex, weightOf, writeDesign, type DesignChange, type DesignTarget, type Subject } from "./designTarget.ts";

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
const ALIGN_LABELS = { left: "Left", center: "Centre", right: "Right" } as const;
const DASH_LABELS: Readonly<Record<string, string>> = { draw: "Draw", solid: "Solid", dashed: "Dashed", dotted: "Dotted" };

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
      className={cn("flex size-4 items-center justify-center rounded-full border", kind === "stroke" && "border-[3px]")}
      style={kind === "stroke" ? { borderColor: colour } : { background: colour }}
    >
      {view.mixed ? <MixedMark /> : view.none ? <span className="block h-px w-3 rotate-45 bg-destructive" /> : null}
    </span>
  );
};

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
  readonly onPick: (hex: string | null | "none") => void;
}) => {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const pickLatest = useRef(onPick);
  pickLatest.current = onPick;
  useEffect(() => {
    const input = picker.current;
    if (!open || input === null) return;
    const onChange = () => pickLatest.current(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, [open]);
  const pick = (value: string | null | "none") => {
    onPick(value);
    setOpen(false);
  };
  const commitHex = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    const hex = (trimmed.startsWith("#") ? trimmed : `#${trimmed}`).toLowerCase();
    if (hex !== view.value) onPick(hex);
  };
  const current = view.mixed ? undefined : view.value;
  return (
    <Popover open={open} onOpenChange={(next) => (setOpen(next), next && setDraft(view.mixed ? "" : view.value))}>
      <Tip label={label} side="top">
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} data-style-control={kind === "text" ? "textColor" : kind} />}>
          <SwatchFace kind={kind} view={view} />
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="top" align="center" padding="compact" className="w-56" aria-label={`${label} swatches`} initialFocus={false} finalFocus={canvasFocus(editor)} onKeyDown={keepEscape(editor)}>
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${label} swatches`}>
          <SwatchButton name="Default" selected={!view.mixed && !view.none && current === ""} onClick={() => pick(null)}>
            <span aria-hidden className="block size-full rounded-full bg-[linear-gradient(135deg,var(--foreground)_50%,var(--background)_50%)]" />
          </SwatchButton>
          {ANNOTATION_SWATCHES.map((swatch) => (
            <SwatchButton key={swatch.hex} name={swatch.name} selected={current === swatch.hex} onClick={() => pick(swatch.hex)}>
              <span aria-hidden className="block size-full rounded-full" style={{ background: swatch.hex }} />
            </SwatchButton>
          ))}
          {allowNone && (
            <SwatchButton name="None" selected={view.none === true} onClick={() => pick("none")}>
              <span aria-hidden className="relative block size-full rounded-full border">
                <span className="absolute top-1/2 left-0.5 right-0.5 h-px -rotate-45 bg-destructive" />
              </span>
            </SwatchButton>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="color"
            aria-label={`${label} picker`}
            className="w-10 shrink-0"
            ref={picker}
            defaultValue={(current || view.shown || "#000000").slice(0, 7)}
          />
          <Input
            aria-label="Hex"
            value={draft}
            placeholder={view.mixed ? MIXED : view.shown || "#rrggbb"}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitHex}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitHex();
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
};

const SwatchButton = ({ name, selected, onClick, children }: { readonly name: string; readonly selected: boolean; readonly onClick: () => void; readonly children: ReactNode }) => (
  <Tip label={name} side="top">
    <Button variant="ghost" size="icon-xs" aria-label={name} aria-pressed={selected} onClick={onClick}>
      <span className={cn("block size-5 rounded-full", selected && "ring-2 ring-primary ring-offset-1 ring-offset-background")}>{children}</span>
    </Button>
  </Tip>
);

const RadioMenu = ({
  label,
  control,
  trigger,
  value,
  options,
  onPick,
}: {
  readonly label: string;
  readonly control: StyleControl;
  readonly trigger: ReactNode;
  readonly value: string | undefined;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: ReactNode }>;
  readonly onPick: (value: string) => void;
}) => {
  const editor = useEditor();
  return (
    <Menu>
      <Tip label={label} side="top">
        <MenuTrigger render={<Button variant="ghost" size="sm" aria-label={label} data-style-control={control} />}>{trigger}</MenuTrigger>
      </Tip>
      <MenuPopup side="top" align="center" className="min-w-32" finalFocus={canvasFocus(editor)} onKeyDown={keepEscape(editor)}>
        <MenuRadioGroup value={value ?? ""} onValueChange={(picked) => onPick(String(picked))}>
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="flex items-center justify-between gap-3">
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

const StrokeLine = ({ width }: { readonly width: number }) => (
  <span aria-hidden className="flex h-4 w-4 items-center">
    <span className="block w-full rounded-full bg-foreground" style={{ height: Math.max(1, Math.min(width, 8)) / 1.5 + 0.5 }} />
  </span>
);

const SizeField = ({ value, mixed, onCommit }: { readonly value: string; readonly mixed: boolean; readonly onCommit: (typed: number) => boolean }) => {
  const [refusals, setRefusals] = useState(0);
  return (
    <Tip label="Size" side="top">
      <div className="w-13 *:h-7 [&_input]:h-7 [&_input]:px-1.5 [&_input]:text-xs" data-style-control="size">
        <NumberControl key={refusals} label="Size" value={value} placeholder={mixed ? MIXED : undefined} disabled={false} onCommit={(typed) => !onCommit(typed) && setRefusals((count) => count + 1)} />
      </div>
    </Tip>
  );
};

const controlFor = (editor: Editor, target: DesignTarget, control: StyleControl): ReactNode => {
  const { subjects } = target;
  const write = (change: DesignChange) => writeDesign(editor, target, change);
  const values = (pick: (subject: Subject) => string) => shared(subjects.map(pick));
  const colourView = (key: DesignKey): ColourView => {
    const set = values((subject) => String(shapeDesignOf(subject.shape.meta)[key] ?? ""));
    const shown = values((subject) => toHex(designValue(editor, subject, key)));
    const mixed = set.mixed || shown.mixed;
    return { value: mixed ? "" : set.value, shown: mixed ? "" : shown.value, mixed };
  };
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
          onPick={(hex) => write(hex === "none" ? fillChange(null) : hex === null ? { design: { fillColor: null } } : fillChange(hex))}
        />
      );
    }
    case "stroke":
      return <ColourButton key={control} label="Stroke" kind="stroke" view={colourView("strokeColor")} allowNone={false} onPick={(hex) => hex !== "none" && write({ design: { strokeColor: hex } })} />;
    case "textColor":
      return <ColourButton key={control} label="Text colour" kind="text" view={colourView("textColor")} allowNone={false} onPick={(hex) => hex !== "none" && write({ design: { textColor: hex } })} />;
    case "strokeWidth": {
      const view = values((subject) => numberOf(String(designValue(editor, subject, "strokeWidth") ?? "")));
      const width = Number(view.value);
      const preset = view.mixed ? undefined : strokeWidthPreset(width);
      return (
        <RadioMenu
          key={control}
          label="Stroke width"
          control={control}
          trigger={view.mixed ? <StrokeLine width={2} /> : preset === undefined ? <span className="text-xs tabular-nums">{view.value}</span> : <StrokeLine width={width} />}
          value={preset === undefined ? undefined : String(preset.width)}
          options={STROKE_WIDTH_PRESETS.map((choice) => ({
            value: String(choice.width),
            label: (
              <span className="flex items-center gap-2">
                <StrokeLine width={choice.width} />
                {choice.label}
              </span>
            ),
          }))}
          onPick={(picked) => write({ design: { strokeWidth: Number(picked) } })}
        />
      );
    }
    case "dash": {
      const view = values((subject) => String(props(subject.shape).dash ?? "draw"));
      return (
        <RadioMenu
          key={control}
          label="Dash"
          control={control}
          trigger={<Spline aria-hidden />}
          value={view.mixed ? undefined : view.value}
          options={DASHES.map((dash) => ({ value: dash, label: DASH_LABELS[dash] }))}
          onPick={(picked) => write({ props: () => ({ dash: picked }) })}
        />
      );
    }
    case "font": {
      const view = values(fontOf);
      const custom = !view.mixed && view.value !== "" && !FONT_NAMES.includes(view.value) ? [view.value] : [];
      return (
        <RadioMenu
          key={control}
          label="Font"
          control={control}
          trigger={<span className="max-w-20 truncate text-xs">{view.mixed ? MIXED : view.value}</span>}
          value={view.mixed ? undefined : view.value}
          options={[...custom, ...FONT_NAMES].map((name) => ({ value: name, label: name }))}
          onPick={(picked) => picked !== view.value && write(fontChange(picked))}
        />
      );
    }
    case "size": {
      const view = values((subject) => numberOf(String(designValue(editor, subject, "fontSize") ?? "")));
      return <SizeField key={control} value={view.mixed ? "" : view.value} mixed={view.mixed} onCommit={(typed) => write({ design: { fontSize: typed } })} />;
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
      const Icon = ALIGN_ICONS[(view.mixed ? "left" : view.value) as keyof typeof ALIGN_ICONS] ?? AlignLeft;
      return (
        <RadioMenu
          key={control}
          label="Align"
          control={control}
          trigger={<Icon aria-hidden />}
          value={view.mixed ? undefined : view.value}
          options={(Object.keys(ALIGN_LABELS) as (keyof typeof ALIGN_LABELS)[]).map((align) => ({ value: align, label: ALIGN_LABELS[align] }))}
          onPick={(picked) => {
            const change = alignChange(picked);
            if (change !== undefined) write(change);
          }}
        />
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
      if (event.key === "Escape" && event.target instanceof Element && event.target.closest("[aria-expanded='true']") !== null) editor.markEventAsHandled(event);
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
