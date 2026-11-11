import { designKeysOf, designPatched, designValueRefusal, displayKeyOf, isDesignableType, shapeDesignOf, type DesignableType, type DesignKey, type DesignPatch } from "@unframed/domain";
import { AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getDisplayValues, useEditor, usePassThroughWheelEvents, useValue, type Editor, type StyleProp, type TLShape } from "tldraw";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { ALIGNS, Caption, ColourControl, FontControl, hexOf, KeywordControl, MIXED, NumberControl, numberOf, Row, Section, WEIGHTS } from "../design/controls.tsx";
import { showError } from "../toasts.tsx";
import { metaWithDesign, nextShapeDesign, patchNextShapeDesign, TOOL_TYPES } from "./nextShapeDesign.ts";

const TLDRAW_FONTS: Readonly<Record<string, string>> = { draw: "Draw", sans: "Sans", serif: "Serif", mono: "Mono" };
const FONT_NAMES = Object.values(TLDRAW_FONTS);
const DASHES = ["draw", "solid", "dashed", "dotted"];
const FILLED: readonly DesignableType[] = ["geo", "draw"];
const DASHED: readonly DesignableType[] = ["geo", "draw", "line", "arrow"];
const ALIGNED: readonly DesignableType[] = ["text", "geo", "note"];
const VERTICAL: readonly DesignableType[] = ["geo", "note"];
const PANEL_ALIGNS = ALIGNS.filter((align) => align.value !== "justify");
const VERTICALS = [
  { value: "start", label: "Top", Icon: AlignVerticalJustifyStart },
  { value: "middle", label: "Middle", Icon: AlignVerticalJustifyCenter },
  { value: "end", label: "Bottom", Icon: AlignVerticalJustifyEnd },
] as const;
const ALIGN_PROP: Readonly<Record<string, string>> = { left: "start", center: "middle", right: "end" };
const ALIGN_NAME: Readonly<Record<string, string>> = { start: "left", middle: "center", end: "right", "start-legacy": "left", "middle-legacy": "center", "end-legacy": "right" };
const KIND_LABEL: Readonly<Record<DesignableType, string>> = { text: "Text", geo: "Shape", note: "Sticky note", arrow: "Arrow", draw: "Drawing", line: "Line", highlight: "Highlight" };

interface Subject {
  readonly type: DesignableType;
  readonly shape: TLShape;
}

const props = (shape: TLShape) => shape.props as Record<string, unknown>;

const toHex = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map((digit) => digit + digit).join("")}`.toLowerCase();
  const p3 = /^color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
  if (p3 !== null) return hexOf(`rgb(${p3.slice(1, 4).map((channel) => Number(channel) * 255).join(",")})`);
  if (text.startsWith("rgb")) return hexOf(text);
  return "";
};

const weightOf = (value: unknown): string => {
  const text = String(value ?? "");
  if (text === "normal" || text === "") return "400";
  if (text === "bold") return "700";
  return text;
};

const nextShapeOf = (editor: Editor, type: DesignableType): TLShape => {
  const util = editor.getShapeUtil(type);
  const initial = { ...util.getDefaultProps() } as unknown as Record<string, unknown>;
  for (const [style, key] of editor.styleProps[type] ?? []) initial[key] = editor.getStyleForNextShape(style);
  return { id: "shape:next", typeName: "shape", type, x: 0, y: 0, rotation: 0, index: "a1", parentId: editor.getCurrentPageId(), isLocked: false, opacity: editor.getInstanceState().opacityForNextShape, props: initial, meta: { unframed: { design: nextShapeDesign(editor) } } } as unknown as TLShape;
};

const styleNamed = (editor: Editor, type: DesignableType, key: string): StyleProp<unknown> | undefined => {
  for (const [style, propKey] of editor.styleProps[type] ?? []) if (propKey === key) return style;
  return undefined;
};

const designValue = (editor: Editor, subject: Subject, key: DesignKey): unknown => {
  const set = shapeDesignOf(subject.shape.meta)[key];
  if (set !== undefined) return set;
  const target = displayKeyOf(subject.type, key);
  if (target === undefined) return undefined;
  const util = editor.getShapeUtil(subject.type) as unknown as Parameters<typeof getDisplayValues>[0];
  return (getDisplayValues(util, subject.shape) as Record<string, unknown>)[target];
};

const shared = (values: readonly string[]): { readonly value: string; readonly mixed: boolean } => ({
  value: values[0] ?? "",
  mixed: values.some((value) => value !== values[0]),
});

const subjectsOf = (editor: Editor): { readonly subjects: readonly Subject[]; readonly next: boolean } => {
  const type = TOOL_TYPES[editor.getCurrentToolId()];
  if (type !== undefined) return { subjects: [{ type, shape: nextShapeOf(editor, type) }], next: true };
  const selected = editor
    .getSelectedShapes()
    .filter((shape) => isDesignableType(shape.type))
    .map((shape) => ({ type: shape.type as DesignableType, shape }));
  return { subjects: selected, next: false };
};

const useSubjects = (editor: Editor): { readonly subjects: readonly Subject[]; readonly next: boolean } => {
  useValue(
    "design panel subjects",
    () => {
      const { subjects } = subjectsOf(editor);
      return `${editor.getColorMode()}\n${subjects.map(({ shape }) => JSON.stringify([shape.id, shape.opacity, shape.props, shape.meta])).join("\n")}`;
    },
    [editor],
  );
  return subjectsOf(editor);
};

const titleOf = (subjects: readonly Subject[], next: boolean): string => {
  if (subjects.length > 1) return `${subjects.length} shapes`;
  const [only] = subjects;
  if (only === undefined) return "";
  const geo = only.type === "geo" ? String(props(only.shape).geo ?? "") : "";
  const label = geo === "" ? KIND_LABEL[only.type] : `${geo.charAt(0).toUpperCase()}${geo.slice(1).replace(/-/g, " ")}`;
  return next ? `Next ${label.toLowerCase()}` : label;
};

export const DesignPanel = () => {
  const editor = useEditor();
  const { subjects, next } = useSubjects(editor);
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

  const write = (change: { readonly design?: DesignPatch; readonly props?: (subject: Subject) => Record<string, unknown> | undefined; readonly opacity?: number }) => {
    const refusal = Object.entries(change.design ?? {})
      .map(([key, value]) => (value === null ? null : designValueRefusal(key as DesignKey, value)))
      .find((text) => text !== null);
    if (refusal !== undefined && refusal !== null) {
      showError(refusal);
      return false;
    }
    if (next) {
      const [subject] = subjects;
      if (change.design !== undefined) patchNextShapeDesign(editor, change.design);
      if (change.opacity !== undefined) editor.setOpacityForNextShapes(change.opacity);
      for (const [key, value] of Object.entries((subject && change.props?.(subject)) ?? {})) {
        const style = subject === undefined ? undefined : styleNamed(editor, subject.type, key);
        if (style !== undefined) editor.setStyleForNextShapes(style, value);
      }
      return true;
    }
    editor.markHistoryStoppingPoint("design panel");
    editor.updateShapes(
      subjects.map(({ shape, ...subject }) => {
        const extra = change.props?.({ shape, ...subject });
        return {
          id: shape.id,
          type: shape.type,
          ...(change.opacity === undefined ? {} : { opacity: change.opacity }),
          ...(change.design === undefined ? {} : { meta: metaWithDesign(shape.meta, designPatched(shapeDesignOf(shape.meta), change.design)) }),
          ...(extra === undefined ? {} : { props: extra }),
        };
      }),
    );
    return true;
  };

  const values = (pick: (subject: Subject) => string) => shared(subjects.map(pick));
  const numeric = (key: DesignKey) => values((subject) => numberOf(String(designValue(editor, subject, key) ?? "")));
  const colour = (key: DesignKey) => values((subject) => toHex(designValue(editor, subject, key)));

  const numberRow = (label: string, key: DesignKey, options: { readonly placeholder?: string } = {}) => {
    const view = numeric(key);
    return (
      <Row label={label}>
        <NumberControl label={label} value={view.mixed ? "" : view.value} placeholder={view.mixed ? MIXED : options.placeholder} disabled={false} onCommit={(typed) => write({ design: { [key]: typed } })} />
      </Row>
    );
  };

  const colourRow = (label: string, key: DesignKey, empty?: string) => {
    const view = colour(key);
    return (
      <Row label={label}>
        <ColourControl label={label} hex={view.value} mixed={view.mixed} disabled={false} empty={empty} onCommit={(hex) => write({ design: { [key]: hex } })} />
      </Row>
    );
  };

  const font = values((subject) => shapeDesignOf(subject.shape.meta).fontFamily ?? TLDRAW_FONTS[String(props(subject.shape).font)] ?? "");
  const weight = values((subject) => weightOf(designValue(editor, subject, "fontWeight")));
  const align = values((subject) => ALIGN_NAME[String(props(subject.shape)[subject.type === "text" ? "textAlign" : "align"])] ?? "left");
  const vertical = values((subject) => String(props(subject.shape).verticalAlign ?? "middle"));
  const dash = values((subject) => String(props(subject.shape).dash ?? "draw"));
  const fillNone = subjects.some((subject) => FILLED.includes(subject.type) && props(subject.shape).fill === "none");
  const fill = fillNone ? { value: "", mixed: !subjects.every((subject) => props(subject.shape).fill === "none") } : colour("fillColor");
  const opacity = values((subject) => String(Math.round(subject.shape.opacity * 100)));
  const strokeName = all(["geo", "note"]) ? "Border" : "Stroke";

  const commitFont = (typed: string): boolean => {
    const named = Object.entries(TLDRAW_FONTS).find(([, name]) => name.toLowerCase() === typed.toLowerCase())?.[0];
    if (named !== undefined) return write({ design: { fontFamily: null }, props: () => ({ font: named }) });
    return write({ design: { fontFamily: typed } });
  };

  return createPortal(
    <div
      ref={ref}
      data-unframed-design-panel=""
      data-testid="design-panel"
      aria-label="Design"
      role="region"
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col gap-3 *:shrink-0 overflow-y-auto overflow-x-hidden overscroll-none border-l bg-background p-2.5 pb-14 font-sans text-foreground"
    >
      <span className="min-w-0 truncate text-sm font-semibold">{titleOf(subjects, next)}</span>

      {has("fontSize") && (
        <Section name="Text" note={null}>
          <Row label="Font">
            <FontControl value={font.mixed ? "" : font.value} placeholder={font.mixed ? MIXED : undefined} disabled={false} families={FONT_NAMES} generics={["system-ui", "Georgia", "Helvetica"]} onCommit={commitFont} />
          </Row>
          {numberRow("Size", "fontSize")}
          {has("fontWeight") && (
            <Row label="Weight">
              <KeywordControl label="Weight" value={weight.value} mixed={weight.mixed} options={WEIGHTS} disabled={false} onPick={(picked) => write({ design: { fontWeight: picked } })} />
            </Row>
          )}
          {numberRow("Line height", "lineHeight")}
          {all(ALIGNED) && (
            <Row label="Align">
              <ToggleGroup
                aria-label="Align"
                value={align.mixed ? [] : [align.value]}
                onValueChange={(picked) => {
                  const [value] = picked as string[];
                  const prop = value === undefined ? undefined : ALIGN_PROP[value];
                  if (prop !== undefined) write({ props: (subject) => ({ [subject.type === "text" ? "textAlign" : "align"]: prop }) });
                }}
              >
                {PANEL_ALIGNS.map(({ value, label, Icon }) => (
                  <Toggle key={value} value={value} aria-label={label}>
                    <Icon aria-hidden />
                  </Toggle>
                ))}
              </ToggleGroup>
            </Row>
          )}
          {all(VERTICAL) && (
            <Row label="Vertical">
              <ToggleGroup
                aria-label="Vertical align"
                value={vertical.mixed ? [] : [vertical.value]}
                onValueChange={(picked) => {
                  const [value] = picked as string[];
                  if (value !== undefined) write({ props: () => ({ verticalAlign: value }) });
                }}
              >
                {VERTICALS.map(({ value, label, Icon }) => (
                  <Toggle key={value} value={value} aria-label={label}>
                    <Icon aria-hidden />
                  </Toggle>
                ))}
              </ToggleGroup>
            </Row>
          )}
          {colourRow("Colour", "textColor")}
        </Section>
      )}

      {has("fillColor") && (
        <Section name="Fill" note={null}>
          <Row label="Background">
            <div className="flex min-w-0 items-center gap-1">
              <ColourControl
                label="Background"
                hex={fill.value}
                mixed={fill.mixed}
                disabled={false}
                empty="None"
                onCommit={(hex) => write({ design: { fillColor: hex }, props: (subject) => (FILLED.includes(subject.type) ? { fill: "solid" } : undefined) })}
              />
              {all(FILLED) && !(fillNone && !fill.mixed) && (
                <Button variant="ghost" size="xs" onClick={() => write({ design: { fillColor: null }, props: () => ({ fill: "none" }) })}>
                  None
                </Button>
              )}
            </div>
          </Row>
        </Section>
      )}

      <Section name="Shape" note={null}>
        {has("strokeColor") && (
          <Row label={strokeName}>
            <div role="group" aria-label={strokeName} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <div className="w-20">
                <Caption>Width</Caption>
                {(() => {
                  const view = numeric("strokeWidth");
                  return <NumberControl label={`${strokeName} width`} value={view.mixed ? "" : view.value} placeholder={view.mixed ? MIXED : undefined} disabled={false} onCommit={(typed) => write({ design: { strokeWidth: typed } })} />;
                })()}
              </div>
              {all(DASHED) && (
                <div className="min-w-24 flex-1">
                  <Caption>Style</Caption>
                  <KeywordControl label={`${strokeName} style`} value={dash.value} mixed={dash.mixed} options={DASHES} disabled={false} onPick={(picked) => write({ props: () => ({ dash: picked }) })} />
                </div>
              )}
              <div>
                <Caption>Colour</Caption>
                {(() => {
                  const view = colour("strokeColor");
                  return <ColourControl label={`${strokeName} colour`} hex={view.value} mixed={view.mixed} disabled={false} onCommit={(hex) => write({ design: { strokeColor: hex } })} />;
                })()}
              </div>
            </div>
          </Row>
        )}
        {has("cornerRadius") && numberRow("Corner radius", "cornerRadius")}
        <Row label="Opacity">
          <NumberControl
            label="Opacity"
            value={opacity.mixed ? "" : opacity.value}
            placeholder={opacity.mixed ? MIXED : undefined}
            disabled={false}
            onCommit={(typed) => write({ opacity: Math.min(100, Math.max(0, typed)) / 100 })}
          />
        </Row>
      </Section>
    </div>,
    editor.getContainer(),
  );
};
