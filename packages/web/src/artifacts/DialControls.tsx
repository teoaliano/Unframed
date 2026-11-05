import { mergeDialValues, normaliseDials, type DialSchema, type DialsAnnouncement } from "@unframed/domain";
import { createDialKit, createDialRoot } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";
import { useEffect, useRef, useState } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { Tooltip, TooltipPopup } from "~/components/ui/tooltip";

const WRITE_DELAY_MS = 400;
const TIP_DELAY_MS = 400;

const LABELS = ".dialkit-slider-label, .dialkit-labeled-control-label, .dialkit-text-label, .dialkit-color-label, .dialkit-select-label, .dialkit-pad-label, .dialkit-image-label";

export interface DialChrome {
  readonly toolbar: HTMLElement;
  readonly below: HTMLElement;
  readonly values: () => Readonly<Record<string, unknown>>;
}

const bodyOf = (folder: Element): Element | null => folder.querySelector(":scope > .dialkit-folder-content > .dialkit-folder-inner");

const describeLabels = (body: Element | null, schema: DialSchema): void => {
  if (!body) return;
  const entries = Object.values(schema);
  const controls = [...body.children];
  if (controls.length !== entries.length) return;
  entries.forEach((entry, index) => {
    const control = controls[index]!;
    const label = entry.kind === "folder" ? control.querySelector(":scope > .dialkit-folder-header .dialkit-folder-title") : control.querySelector(LABELS);
    if (label instanceof HTMLElement && entry.description !== undefined) {
      label.dataset.unframedDescription = entry.description;
      const named = entry.kind === "folder" ? control.querySelector(":scope > .dialkit-folder-header > .dialkit-folder-header-top") : (label.closest("[role], button, label") ?? control);
      named?.setAttribute("aria-description", entry.description);
    }
    if (entry.kind === "folder") describeLabels(bodyOf(control), entry.of);
  });
};

const withChrome = (target: HTMLElement): DialChrome | undefined => {
  const toolbar = target.querySelector<HTMLElement>(".dialkit-panel-toolbar");
  const header = toolbar?.closest(".dialkit-panel-header");
  if (!toolbar || !header) return undefined;
  toolbar.querySelector<HTMLElement>(".dialkit-toolbar-primary")?.style.setProperty("display", "none");
  const slot = document.createElement("div");
  slot.dataset.dialToolbar = "";
  slot.style.display = "contents";
  toolbar.append(slot);
  const below = document.createElement("div");
  below.dataset.dialBelowHeader = "";
  header.after(below);
  return { toolbar: slot, below, values: () => ({}) };
};

interface DialControlsProps {
  readonly shapeId: TLShapeId;
  readonly announcement: DialsAnnouncement;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  readonly post: (values: unknown) => void;
  readonly onWrite?: (values: Readonly<Record<string, unknown>>) => void;
  readonly onChrome?: (chrome: DialChrome | undefined) => void;
}

export const DialControls = ({ shapeId, announcement, saved, post, onWrite, onChrome }: DialControlsProps) => {
  const chromeTo = useRef(onChrome);
  chromeTo.current = onChrome;
  const [tip, setTip] = useState<{ readonly anchor: HTMLElement; readonly text: string }>();
  const editor = useEditor();
  const writtenTo = useRef(onWrite);
  writtenTo.current = onWrite;
  const host = useRef<HTMLDivElement>(null);
  const savedNow = useRef(saved);
  savedNow.current = saved;
  const postNow = useRef(post);
  postNow.current = post;
  const announced = JSON.stringify([announcement.name, announcement.config]);
  const latest = useRef(announcement);
  latest.current = announcement;
  const pending = useRef<Record<string, unknown> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const write = () => {
    clearTimeout(timer.current);
    const values = pending.current;
    pending.current = undefined;
    const shape = values === undefined ? undefined : editor.getShape(shapeId);
    if (!shape || values === undefined) return;
    writtenTo.current?.(values);
    savedNow.current = values;
    editor.markHistoryStoppingPoint("tune parameters");
    editor.updateShape({ id: shapeId, type: shape.type, props: { dials: values } } as Parameters<typeof editor.updateShape>[0]);
  };
  const writeNow = useRef(write);
  writeNow.current = write;

  useEffect(() => () => writeNow.current(), []);

  useEffect(() => {
    const target = host.current;
    const current = latest.current;
    const normalised = normaliseDials(current.config);
    if (!target || !normalised.ok) return;
    const name = current.name === "" ? "Parameters" : current.name;
    const scheme = () => (document.documentElement.getAttribute("data-unframed-theme") === "dark" ? "dark" : "light");
    const root = createDialRoot({ target, mode: "inline", theme: scheme(), productionEnabled: true, defaultOpen: true });
    const follow = new MutationObserver(() => {
      root.element.dataset.theme = scheme();
    });
    follow.observe(document.documentElement, { attributes: true, attributeFilter: ["data-unframed-theme"] });
    const kit = createDialKit(name, normalised.dialkit as Parameters<typeof createDialKit>[1], { id: `unframed-${name}` });
    const merged = mergeDialValues(normalised.schema, savedNow.current ?? null);
    for (const [key, value] of Object.entries(merged)) {
      try {
        kit.setValues({ [key]: value } as Parameters<typeof kit.setValues>[0]);
      } catch {
      }
    }
    let currentValues: Record<string, unknown> = merged;
    describeLabels(target.querySelector(".dialkit-folder-root > .dialkit-folder-content > .dialkit-folder-inner"), normalised.schema);
    const chrome = withChrome(target);
    if (chrome) chromeTo.current?.({ ...chrome, values: () => currentValues });
    let hovered: HTMLElement | undefined;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      clearTimeout(waiting);
      hovered = undefined;
      setTip(undefined);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) return leave();
      const over = [...target.querySelectorAll<HTMLElement>("[data-unframed-description]")].find((label) => {
        const box = label.getBoundingClientRect();
        return box.width > 0 && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (over === hovered) return;
      leave();
      if (!over) return;
      hovered = over;
      waiting = setTimeout(() => setTip({ anchor: over, text: over.dataset.unframedDescription ?? "" }), TIP_DELAY_MS);
    };
    target.addEventListener("pointermove", move, true);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointerdown", leave, true);
    const stop = kit.subscribe((values) => {
      currentValues = values as Record<string, unknown>;
      postNow.current(values);
      pending.current = values as Record<string, unknown>;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => writeNow.current(), WRITE_DELAY_MS);
    }, false);
    return () => {
      target.removeEventListener("pointermove", move, true);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointerdown", leave, true);
      leave();
      if (chrome) chromeTo.current?.(undefined);
      chrome?.below.remove();
      follow.disconnect();
      stop();
      writeNow.current();
      kit.destroy();
      root.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the announced text, which the effect reads through `latest`
  }, [announced]);

  return (
    <>
      <div ref={host} data-testid="artifact-dials" />
      <Tooltip open={tip !== undefined}>
        {tip && (
          <TooltipPopup anchor={tip.anchor} side="top" sideOffset={6} data-testid="parameter-description">
            {tip.text}
          </TooltipPopup>
        )}
      </Tooltip>
    </>
  );
};
