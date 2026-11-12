import { designKeysOf, type DesignableType, type DesignKey } from "@unframed/domain";
import { X } from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEditor, usePassThroughWheelEvents } from "tldraw";
import { Button } from "~/components/ui/button";
import { Tip } from "../chrome/ui.tsx";
import { numberOf, WEIGHTS } from "../design/controls.tsx";
import { useDesignPanelOpen } from "./designPanelPref.ts";
import { DialButtons, DialColour, DialScope, DialSection, DialSegmented, DialSelect, DialSlider } from "./dialLazy.tsx";
import { ALIGN_OPTIONS, alignChange, alignOf, DASH_OPTIONS, designValue, FILLED, SIZE_RANGE, STROKE_WIDTH_RANGE, fillChange, fillOf, FONT_NAMES, fontChange, fontOf, panelTarget, props, shared, toHex, useDesignTarget, weightOf, writeDesign, type DesignChange, type Subject } from "./designTarget.ts";

const DASHED: readonly DesignableType[] = ["geo", "draw", "line", "arrow"];
const ALIGNED: readonly DesignableType[] = ["text", "geo", "note"];
const VERTICAL: readonly DesignableType[] = ["geo", "note"];
const VERTICALS = [
  { value: "start", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "end", label: "Bottom" },
];
const GENERIC_FONTS = ["system-ui", "Georgia", "Helvetica"];
const KIND_LABEL: Readonly<Record<DesignableType, string>> = { text: "Text", geo: "Shape", note: "Sticky note", arrow: "Arrow", draw: "Drawing", line: "Line", highlight: "Highlight" };

const titleOf = (subjects: readonly Subject[], next: boolean): string => {
  if (subjects.length > 1) return `${subjects.length} shapes`;
  const [only] = subjects;
  if (only === undefined) return "";
  const geo = only.type === "geo" ? String(props(only.shape).geo ?? "") : "";
  const label = geo === "" ? KIND_LABEL[only.type] : `${geo.charAt(0).toUpperCase()}${geo.slice(1).replace(/-/g, " ")}`;
  return next ? `Next ${label.toLowerCase()}` : label;
};

export const DesignPanel = () => {
  const [open] = useDesignPanelOpen();
  return open ? <OpenDesignPanel /> : null;
};

const OpenDesignPanel = () => {
  const editor = useEditor();
  const target = useDesignTarget(editor, panelTarget);
  const { subjects, next } = target;
  const [, setOpen] = useDesignPanelOpen();
  const ref = useRef<HTMLDivElement>(null);
  usePassThroughWheelEvents(ref);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const onPointerMove = (event: PointerEvent) => editor.markEventAsHandled(event);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.contains(element.ownerDocument.activeElement)) return;
      event.stopPropagation();
      editor.getContainer().focus();
    };
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [editor, subjects.length]);

  if (subjects.length === 0) return null;

  const all = (types: readonly DesignableType[]) => subjects.every((subject) => types.includes(subject.type));
  const has = (key: DesignKey) => subjects.every((subject) => designKeysOf(subject.type).includes(key));

  const write = (change: DesignChange, burst?: string) => writeDesign(editor, target, change, burst);

  const values = (pick: (subject: Subject) => string) => shared(subjects.map(pick));
  const numeric = (key: DesignKey) => values((subject) => numberOf(String(designValue(editor, subject, key) ?? "")));
  const colour = (key: DesignKey) => values((subject) => toHex(designValue(editor, subject, key)));
  const numberAt = (key: DesignKey, fallback: number) => {
    const value = Number(numeric(key).value);
    return Number.isFinite(value) ? value : fallback;
  };

  const slider = (label: string, key: DesignKey, range: { readonly min: number; readonly max: number; readonly step: number }, fallback: number, unit?: string) => (
    <DialSlider label={label} value={numberAt(key, fallback)} {...range} {...(unit === undefined ? {} : { unit })} onChange={(next) => write({ design: { [key]: next } }, key)} />
  );

  const colourField = (label: string, key: DesignKey, onPick: (hex: string) => void = (hex) => write({ design: { [key]: hex } }, key)) => {
    const view = colour(key);
    return <DialColour label={label} value={(view.mixed || view.value === "" ? "#000000" : view.value).slice(0, 7)} onChange={(hex) => /^#[0-9a-f]{6}$/i.test(hex) && hex.toLowerCase() !== view.value && onPick(hex.toLowerCase())} />;
  };

  const font = values(fontOf);
  const fonts = [...new Set([...(font.mixed || font.value === "" ? [] : [font.value]), ...FONT_NAMES, ...GENERIC_FONTS])];
  const weight = values((subject) => weightOf(designValue(editor, subject, "fontWeight")));
  const align = values(alignOf);
  const vertical = values((subject) => String(props(subject.shape).verticalAlign ?? "middle"));
  const dash = values((subject) => String(props(subject.shape).dash ?? "draw"));
  const fill = fillOf(editor, subjects);
  const opacity = values((subject) => String(Math.round(subject.shape.opacity * 100)));
  const strokeName = all(["geo", "note"]) ? "Border" : "Stroke";

  return createPortal(
    <div
      ref={ref}
      data-unframed-design-panel=""
      data-testid="design-panel"
      aria-label="Design"
      role="region"
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col gap-3 *:shrink-0 overflow-y-auto overflow-x-hidden overscroll-none border-l border-(--design-panel-border) bg-(--design-panel-surface) p-2.5 pb-14 font-sans text-(--design-panel-foreground)"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{titleOf(subjects, next)}</span>
        <Tip label="Close">
          <Button variant="ghost" size="icon-xs" aria-label="Close design panel" onClick={() => setOpen(false)}>
            <X aria-hidden />
          </Button>
        </Tip>
      </div>
      <Suspense fallback={null}>
        <DialScope>
          {has("fontSize") && (
            <DialSection title="Text">
              <DialSelect label="Font" value={font.mixed ? "" : font.value} options={fonts} onChange={(picked) => picked !== font.value && write(fontChange(picked))} />
              {slider("Size", "fontSize", SIZE_RANGE, 22, "px")}
              {has("fontWeight") && <DialSelect label="Weight" value={weight.mixed ? "" : weight.value} options={WEIGHTS} onChange={(picked) => write({ design: { fontWeight: picked } })} />}
              {slider("Line height", "lineHeight", { min: 0.5, max: 3, step: 0.05 }, 1.35)}
              {all(ALIGNED) && (
                <DialSegmented
                  label="Align"
                  value={align.mixed ? "" : align.value}
                  options={ALIGN_OPTIONS}
                  onChange={(picked) => {
                    const change = alignChange(picked);
                    if (change !== undefined) write(change);
                  }}
                />
              )}
              {all(VERTICAL) && <DialSegmented label="Vertical" value={vertical.mixed ? "" : vertical.value} options={VERTICALS} onChange={(picked) => write({ props: () => ({ verticalAlign: picked }) })} />}
              {has("textColor") && colourField("Colour", "textColor")}
            </DialSection>
          )}

          {has("fillColor") && (
            <DialSection title="Fill">
              {colourField("Background", "fillColor", (hex) => write(fillChange(hex), "fillColor"))}
              {all(FILLED) && <DialButtons buttons={[{ label: fill.none && !fill.mixed ? "No fill" : "None", onClick: () => write(fillChange(null)) }]} />}
            </DialSection>
          )}

          <DialSection title="Shape">
            {has("strokeColor") && (
              <>
                {slider(`${strokeName} width`, "strokeWidth", STROKE_WIDTH_RANGE, 2, "px")}
                {all(DASHED) && <DialSegmented label={`${strokeName} style`} value={dash.mixed ? "" : dash.value} options={DASH_OPTIONS} onChange={(picked) => write({ props: () => ({ dash: picked }) })} />}
                {colourField(`${strokeName} colour`, "strokeColor")}
              </>
            )}
            {has("cornerRadius") && slider("Corner radius", "cornerRadius", { min: 0, max: 100, step: 1 }, 0, "px")}
            <DialSlider label="Opacity" value={Number(opacity.value) || 0} min={0} max={100} step={1} unit="%" onChange={(next) => write({ opacity: Math.min(100, Math.max(0, next)) / 100 }, "opacity")} />
          </DialSection>
        </DialScope>
      </Suspense>
    </div>,
    editor.getContainer(),
  );
};
