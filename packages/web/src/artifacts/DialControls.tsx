/**
 * An artifact's parameters as DialKit controls (spec 09), shared by the editor's Parameters
 * column and the canvas's Parameters panel. Only lazily loaded modules import this one, so
 * DialKit and its stylesheet never reach a board where neither is open.
 */
import { mergeDialValues, normaliseDials, type DialsAnnouncement } from "@unframed/domain";
import { createDialKit, createDialRoot } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";
import { useEffect, useRef } from "react";
import { useEditor, type TLShapeId } from "tldraw";

/** A dial change is written to the shape this long after the last one. */
const WRITE_DELAY_MS = 400;

export interface DialControlsProps {
  readonly shapeId: TLShapeId;
  /** What the artifact last announced. */
  readonly announcement: DialsAnnouncement;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  /** Posts `unframed:dials:set` to the artifact's frame. */
  readonly post: (values: unknown) => void;
}

/** DialKit, inline, on the announced config. Rebuilt only when a new announcement arrives. */
export const DialControls = ({ shapeId, announcement, saved, post }: DialControlsProps) => {
  const editor = useEditor();
  const host = useRef<HTMLDivElement>(null);
  const savedNow = useRef(saved);
  savedNow.current = saved;
  const postNow = useRef(post);
  postNow.current = post;
  const pending = useRef<Record<string, unknown> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // One tldraw history step per settled change, so Cmd-Z on the canvas takes a whole drag back.
  const write = () => {
    clearTimeout(timer.current);
    const values = pending.current;
    pending.current = undefined;
    const shape = values === undefined ? undefined : editor.getShape(shapeId);
    if (!shape || values === undefined) return;
    editor.markHistoryStoppingPoint("tune parameters");
    editor.updateShape({ id: shapeId, type: shape.type, props: { dials: values } } as Parameters<typeof editor.updateShape>[0]);
  };
  const writeNow = useRef(write);
  writeNow.current = write;

  // A change made just before the controls go away is flushed, never dropped.
  useEffect(() => () => writeNow.current(), []);

  useEffect(() => {
    const target = host.current;
    const normalised = normaliseDials(announcement.config);
    if (!target || !normalised.ok) return;
    const name = announcement.name === "" ? "Parameters" : announcement.name;
    // DialKit follows the app's scheme; its colours come from the tokens (theme/vendors.css).
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
        // DialKit refused this value: the control keeps its default.
      }
    }
    const stop = kit.subscribe((values) => {
      postNow.current(values);
      pending.current = values as Record<string, unknown>;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => writeNow.current(), WRITE_DELAY_MS);
    }, false);
    return () => {
      follow.disconnect();
      stop();
      writeNow.current();
      kit.destroy();
      root.destroy();
    };
  }, [announcement]);

  return <div ref={host} data-testid="artifact-dials" />;
};
