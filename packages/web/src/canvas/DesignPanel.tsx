import { designKeysOf, type DesignableType, type DesignKey } from "@unframed/domain";
import { AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEditor, usePassThroughWheelEvents } from "tldraw";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../chrome/ui.tsx";
import { ALIGNS, Caption, ColourControl, FontControl, KeywordControl, MIXED, NumberControl, numberOf, Row, Section, WEIGHTS } from "../design/controls.tsx";
import { useDesignPanelOpen } from "./designPanelPref.ts";
import { alignChange, alignOf, DASHES, designValue, FILLED, fillChange, fillOf, FONT_NAMES, fontChange, fontOf, panelTarget, props, shared, toHex, useDesignTarget, weightOf, writeDesign, type DesignChange, type Subject } from "./designTarget.ts";

const DASHED: readonly DesignableType[] = ["geo", "draw", "line", "arrow"];
const ALIGNED: readonly DesignableType[] = ["text", "geo", "note"];
const VERTICAL: readonly DesignableType[] = ["geo", "note"];
const PANEL_ALIGNS = ALIGNS.filter((align) => align.value !== "justify");
const VERTICALS = [
  { value: "start", label: "Top", Icon: AlignVerticalJustifyStart },
  { value: "middle", label: "Middle", Icon: AlignVerticalJustifyCenter },
  { value: "end", label: "Bottom", Icon: AlignVerticalJustifyEnd },
] as const;
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

  const write = (change: DesignChange) => writeDesign(editor, target, change);

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

  const font = values(fontOf);
  const weight = values((subject) => weightOf(designValue(editor, subject, "fontWeight")));
  const align = values(alignOf);
  const vertical = values((subject) => String(props(subject.shape).verticalAlign ?? "middle"));
  const dash = values((subject) => String(props(subject.shape).dash ?? "draw"));
  const fill = fillOf(editor, subjects);
  const opacity = values((subject) => String(Math.round(subject.shape.opacity * 100)));
  const strokeName = all(["geo", "note"]) ? "Border" : "Stroke";

  const commitFont = (typed: string): boolean => write(fontChange(typed));

  return createPortal(
    <div
      ref={ref}
      data-unframed-design-panel=""
      data-testid="design-panel"
      aria-label="Design"
      role="region"
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col gap-3 *:shrink-0 overflow-y-auto overflow-x-hidden overscroll-none border-l bg-background p-2.5 pb-14 font-sans text-foreground"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{titleOf(subjects, next)}</span>
        <Tip label="Close">
          <Button variant="ghost" size="icon-xs" aria-label="Close design panel" onClick={() => setOpen(false)}>
            <X aria-hidden />
          </Button>
        </Tip>
      </div>

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
                  const change = value === undefined ? undefined : alignChange(value);
                  if (change !== undefined) write(change);
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
                onCommit={(hex) => write(fillChange(hex))}
              />
              {all(FILLED) && !fill.none && (
                <Button variant="ghost" size="xs" onClick={() => write(fillChange(null))}>
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
