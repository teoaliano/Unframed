import { mergeDialValues, normaliseDials, type DialsAnnouncement } from "@unframed/domain";
import { createDialKit, createDialRoot } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";
import { useEffect, useRef } from "react";
import { useEditor, type TLShapeId } from "tldraw";

const WRITE_DELAY_MS = 400;

export interface DialControlsProps {
  readonly shapeId: TLShapeId;
  readonly announcement: DialsAnnouncement;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  readonly post: (values: unknown) => void;
  readonly onWrite?: (values: Readonly<Record<string, unknown>>) => void;
}

export const DialControls = ({ shapeId, announcement, saved, post, onWrite }: DialControlsProps) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the announced text, which the effect reads through `latest`
  }, [announced]);

  return <div ref={host} data-testid="artifact-dials" />;
};
