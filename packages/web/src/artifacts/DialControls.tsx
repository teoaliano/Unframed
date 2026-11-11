import { mergeDialValues, normaliseDials, type DialSchema, type DialsAnnouncement } from "@unframed/domain";
import { createDialKit, createDialRoot, DialStore, type ControlMeta } from "dialkit/vanilla";
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

const descriptionAt = (schema: DialSchema, path: string): string | undefined => {
  let level: DialSchema | undefined = schema;
  let entry: DialSchema[string] | undefined;
  for (const key of path.split(".")) {
    entry = level?.[key];
    level = entry?.kind === "folder" ? entry.of : undefined;
  }
  return entry?.description;
};

const describeControls = (body: Element | null, controls: ReadonlyArray<ControlMeta>, schema: DialSchema): number => {
  if (!body) return 0;
  let described = 0;
  for (const element of body.children) {
    const folder = element.classList.contains("dialkit-folder");
    const row = folder ? element.querySelector<HTMLElement>(":scope > .dialkit-folder-header > .dialkit-folder-header-top") : (element as HTMLElement);
    const label = folder ? row?.querySelector<HTMLElement>(".dialkit-folder-title") : element.querySelector<HTMLElement>(LABELS);
    const text = label?.textContent?.trim();
    const control = text === undefined ? undefined : controls.find((each) => each.label === text && (each.type === "folder") === folder);
    if (!row || !label || !control) continue;
    const description = descriptionAt(schema, control.path);
    if (description !== undefined) {
      row.dataset.unframedDescription = description;
      label.dataset.unframedLabel = "";
      (folder ? row : (label.closest("[role], button, label") ?? row)).setAttribute("aria-description", description);
      described += 1;
    }
    if (folder) described += describeControls(bodyOf(element), control.children ?? [], schema);
  }
  return described;
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
  const [tip, setTip] = useState<{ readonly anchor: { getBoundingClientRect(): DOMRect }; readonly text: string }>();
  const editor = useEditor();
  const writtenTo = useRef(onWrite);
  writtenTo.current = onWrite;
  const host = useRef<HTMLDivElement>(null);
  const savedNow = useRef(saved);
  savedNow.current = saved;
  const postNow = useRef(post);
  postNow.current = post;
  const announced = JSON.stringify([announcement.name, announcement.config, announcement.descriptions ?? null]);
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
    const normalised = normaliseDials(current.config, current.descriptions);
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
    const described = describeControls(
      target.querySelector(".dialkit-folder-root > .dialkit-folder-content > .dialkit-folder-inner"),
      DialStore.getPanel(kit.id)?.controls ?? [],
      normalised.schema,
    );
    target.dataset.described = String(described);
    const chrome = withChrome(target);
    const shapeDials = () => (editor.getShape(shapeId)?.props as { dials?: unknown } | undefined)?.dials ?? null;
    if (chrome) chromeTo.current?.({ ...chrome, values: () => pending.current ?? mergeDialValues(normalised.schema, shapeDials()) });
    let row: HTMLElement | undefined;
    let shown: HTMLElement | undefined;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(waiting);
      waiting = undefined;
      shown = undefined;
      setTip(undefined);
    };
    const leave = () => {
      row = undefined;
      hide();
    };
    const overLabel = (event: PointerEvent): boolean => {
      const box = row?.querySelector("[data-unframed-label]")?.getBoundingClientRect();
      return box !== undefined && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    };
    const track = (event: PointerEvent) => {
      if (!row) return;
      if (event.buttons !== 0 || !overLabel(event)) return hide();
      if (shown === row || waiting !== undefined) return;
      const at = row;
      waiting = setTimeout(() => {
        waiting = undefined;
        shown = at;
        const panel = target.getBoundingClientRect();
        const line = at.getBoundingClientRect();
        setTip({ anchor: { getBoundingClientRect: () => new DOMRect(panel.left, line.top, panel.width, line.height) }, text: at.dataset.unframedDescription ?? "" });
      }, TIP_DELAY_MS);
    };
    const over = (event: PointerEvent) => {
      const next = event.target instanceof Element ? (event.target.closest<HTMLElement>("[data-unframed-description]") ?? undefined) : undefined;
      if (next !== row) {
        leave();
        row = next;
      }
      track(event);
    };
    const move = (event: PointerEvent) => {
      if (row) track(event);
    };
    target.addEventListener("pointerover", over, true);
    target.addEventListener("pointermove", move, true);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointerdown", hide, true);
    const stop = kit.subscribe((values) => {
      postNow.current(values);
      pending.current = values as Record<string, unknown>;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => writeNow.current(), WRITE_DELAY_MS);
    }, false);
    return () => {
      target.removeEventListener("pointerover", over, true);
      target.removeEventListener("pointermove", move, true);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointerdown", hide, true);
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
          <TooltipPopup anchor={tip.anchor} side="left" sideOffset={8} data-testid="parameter-description">
            {tip.text}
          </TooltipPopup>
        )}
      </Tooltip>
    </>
  );
};
