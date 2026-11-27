import type { ScreenShapeProps } from "@unframed/contracts";
import { classSetting, EMPTY_SCALE, looksTailwind, reorderIndex, screenChip, tokenScaleOf, type ChipElement, type ScreenOverride, type TokenScale } from "@unframed/domain";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { atom, react, useEditor, usePassThroughWheelEvents, useValue, type Editor, type TLShapeId } from "tldraw";
import { useChatClient } from "../agent/store.ts";
import { DesignTab } from "../artifacts/editor/DesignTab.tsx";
import { useEditSession, type EditSession, type SessionStep } from "../artifacts/editor/editSession.ts";
import { tellAgent } from "../artifacts/editor/tellAgent.ts";
import type { EditMessage } from "../artifacts/ArtifactFrame.tsx";
import { useCanvasDoc } from "../canvas/doc.ts";
import { useCanvasProject, useEngine } from "../context.ts";
import { useFeature } from "../features.ts";
import { canvasKey, designCommand, type DesignCommand, type KeyModifiers } from "./designKeys.ts";
import { DesignDrafts } from "./DesignDrafts.tsx";
import { isFlexLike, layerName, mainAxis, parentAxis, type ElementLayout } from "./designLayout.ts";
import { AltDistance, DesignHandles } from "./DesignHandles.tsx";
import { designDraftsOf, designHooksOf, designOf, keepDrafts, keptDraftsOf, leaveDesign, type DesignEntry } from "./designMode.ts";
import { boxOf, DesignOverlay, selectionBox } from "./DesignOverlay.tsx";
import { DesignMenu, type MenuAt } from "./DesignMenu.tsx";
import { useScreenApply } from "./screenApply.ts";
import type { ScreenEditHooks } from "./ScreenView.tsx";
import { repositoryState } from "./store.ts";
import { holdScreen } from "./tiers.ts";

const NONE: readonly string[] = [];
const TAILWIND_DEFAULT = tokenScaleOf({ css: [{ file: "tailwind", text: '@import "tailwindcss";' }] });

const scaleFor = (tokens: TokenScale, className: string | null | undefined): TokenScale => (tokens.spacing.length === 0 && looksTailwind(className) ? TAILWIND_DEFAULT : tokens);
const NO_DIALS: Readonly<Record<string, unknown>> = {};

const typingIn = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null);

const useHost = (project: string, shapeId: string): HTMLElement | null => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const found = document.querySelector<HTMLElement>(`[data-screen-frames="${CSS.escape(project)}"] [data-screen-of="${CSS.escape(shapeId)}"]`);
      setHost((previous) => (previous === found ? previous : found));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [project, shapeId]);
  return host;
};

export const CanvasDesign = () => {
  const editor = useEditor();
  const project = useCanvasProject();
  const repositories = useFeature("repositories");
  const editing = useFeature("element-editing");
  const entry = useValue("design entry", () => designOf(project).get(), [project]);
  useEffect(() => () => leaveDesign(project), [project]);
  useEffect(() => {
    if (!repositories || !editing) leaveDesign(project);
  }, [repositories, editing, project]);
  if (!repositories || !editing || entry === undefined) return null;
  return <DesignSession key={entry.screen} editor={editor} project={project} entry={entry} />;
};

const DesignSession = ({ editor, project, entry }: { readonly editor: Editor; readonly project: string; readonly entry: DesignEntry }) => {
  const doc = useCanvasDoc();
  const engine = useEngine();
  const client = useChatClient(engine, project);
  const shapeId = entry.screen;
  const props = useValue("design screen", () => editor.getShape(shapeId as TLShapeId)?.props as ScreenShapeProps | undefined, [editor, shapeId]);
  const instance = useValue("design instance", () => (props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance)), [project, props?.instance]);
  const applyRef = useRef<ReturnType<typeof useScreenApply> | undefined>(undefined);
  const session = useEditSession({
    doc,
    engine,
    project,
    shapeId,
    kind: "screen",
    file: "",
    locked: NONE,
    kit: null,
    editing: true,
    target: "screen",
    onUndoEmpty: () => void applyRef.current?.undo(),
  });
  const apply = useScreenApply({
    engine,
    project,
    shapeId,
    instance: instance === undefined ? undefined : { id: instance.id, branch: instance.branch, worktree: instance.worktree },
    state: props === undefined ? "" : props.state?.trim() || props.route,
    session,
    client,
  });
  applyRef.current = apply;
  const sessionRef = useRef<EditSession>(session);
  sessionRef.current = session;
  const [layouts, setLayouts] = useState<Readonly<Record<string, ElementLayout>>>({});
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const [alt, setAlt] = useState(false);
  const [resizing, setResizing] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | undefined>(undefined);
  const hostRef = useRef<HTMLElement | null>(null);
  const [tokens, setTokens] = useState<TokenScale>(EMPTY_SCALE);
  const pointer = useMemo(() => atom<{ readonly x: number; readonly y: number } | null>("design pointer", null), []);
  const reorder = useRef<{ readonly id: string; readonly from: number; readonly axis: "row" | "column" } | null>(null);
  const instanceId = instance?.id;
  useEffect(() => {
    if (instanceId === undefined) return;
    let live = true;
    engine.call("screens.tokens", { project, instance: instanceId }).then(
      (answer) => live && setTokens(answer.scale),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, project, instanceId]);
  const pendingPick = useRef(entry.at);
  const discarded = useRef<readonly SessionStep[] | undefined>(undefined);
  const redoable = useRef<SessionStep[]>([]);

  useEffect(() => holdScreen(project, shapeId), [project, shapeId]);

  const frameReady = session.live.length > 0;
  const restored = useRef(false);
  useEffect(() => {
    if (!frameReady || restored.current) return;
    restored.current = true;
    const saved = keptDraftsOf(project).get().get(shapeId);
    if (saved === undefined) return;
    keepDrafts(project, shapeId, undefined);
    sessionRef.current.restoreOverrides(saved.steps, saved.drafts);
  }, [frameReady, project, shapeId]);

  useEffect(
    () => () => {
      if (!restored.current) return;
      const current = sessionRef.current;
      const { steps, drafts } = current.keptSteps();
      keepDrafts(project, shapeId, steps.length === 0 ? undefined : { steps, drafts, count: current.drafts.length });
    },
    [project, shapeId],
  );

  useEffect(
    () =>
      react("design mode selection", () => {
        const ids = editor.getSelectedShapeIds();
        if (editor.getShape(shapeId as TLShapeId) === undefined || ids.length !== 1 || ids[0] !== shapeId) leaveDesign(project);
      }),
    [editor, project, shapeId],
  );

  const leave = () => leaveDesign(project);

  const undo = () => {
    const current = sessionRef.current;
    if (current.overrides.length === 0 && discarded.current !== undefined) {
      const back = discarded.current;
      discarded.current = undefined;
      current.restoreOverrides(back);
      return;
    }
    const last = current.overrides[current.overrides.length - 1];
    if (last !== undefined) redoable.current = [...redoable.current, last];
    current.handleKey("z", { shift: false, meta: true, ctrl: false });
  };

  const redo = () => {
    const next = redoable.current[redoable.current.length - 1];
    if (next === undefined) return;
    redoable.current = redoable.current.slice(0, -1);
    sessionRef.current.restoreOverrides([...sessionRef.current.overrides, next]);
  };

  const discardAll = () => {
    const current = sessionRef.current;
    if (current.overrides.length === 0) return;
    discarded.current = current.overrides;
    redoable.current = [];
    current.discard();
  };

  const run = (command: DesignCommand) => {
    const current = sessionRef.current;
    const selection = current.selection;
    const [only] = selection;
    switch (command.kind) {
      case "escape":
        if (selection.length > 0) current.setSelection([]);
        else leave();
        return;
      case "undo":
        undo();
        return;
      case "redo":
        redo();
        return;
      case "parent": {
        const parent = only === undefined ? undefined : current.tree?.elements.find((element) => element.id === only)?.parent;
        if (selection.length === 1 && parent) current.setSelection([parent]);
        return;
      }
      case "children": {
        if (selection.length !== 1 || only === undefined) return;
        const children = (current.tree?.elements ?? []).filter((element) => element.parent === only).map((element) => element.id);
        if (children.length > 0) current.setSelection(children);
        return;
      }
      case "hide":
        for (const id of selection) current.patch({ type: "hide", elementId: id, hidden: true });
        return;
      case "delete":
        void current.structure({ kind: "delete" }, selection);
        current.setSelection([]);
        return;
      case "duplicate":
      case "wrap":
        void current.structure({ kind: command.kind }, selection);
        return;
      case "move":
        void current.structure({ kind: "move", by: command.by }, selection);
        return;
      case "opacity":
        for (const id of selection) current.patch({ type: "style", elementId: id, property: "opacity", value: String(command.value) });
        return;
      case "text":
        for (const id of selection) textStyle(current, id, command.style);
        return;
      default:
        return;
    }
  };

  const keyContext = () => {
    const current = sessionRef.current;
    const [only] = current.selection;
    const report = only === undefined ? undefined : current.reports[only];
    return {
      selected: current.selection.length > 0,
      text: current.selection.length > 0 && current.selection.every((id) => current.reports[id]?.text !== null && current.reports[id]?.text !== undefined),
      axis: only === undefined || report === undefined ? undefined : parentAxis(layoutsRef.current[only]),
    };
  };

  const onKey = (key: string, modifiers: KeyModifiers): boolean => {
    if (menu !== undefined) return false;
    if (key === "Alt") {
      setAlt(true);
      return false;
    }
    const command = designCommand(key, modifiers, keyContext());
    if (command === undefined) return false;
    if (command.kind !== "undo" && command.kind !== "redo" && command.kind !== "swallow" && command.kind !== "escape") redoable.current = [];
    run(command);
    return true;
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (typingIn(event.target) || typingIn(document.activeElement)) return;
      if (onKeyRef.current(event.key, { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey })) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAlt(false);
    };
    const blur = () => setAlt(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const onEdit = (message: EditMessage) => {
    const current = sessionRef.current;
    if (message.type === "unframed:edit:layouts") {
      if (typeof message.layouts === "object" && message.layouts !== null) setLayouts(message.layouts as Record<string, ElementLayout>);
      return;
    }
    if (message.type === "unframed:edit:key" || message.type === "unframed:edit:keyup") {
      const key = String(message.key ?? "");
      const code = String(message.code ?? "");
      const modifiers = { shift: message.shift === true, meta: message.meta === true, ctrl: message.ctrl === true, alt: message.alt === true };
      const down = message.type === "unframed:edit:key";
      if (!down && key === "Alt") setAlt(false);
      if (down && onKeyRef.current(key, modifiers)) return;
      if (!canvasKey(key, code, modifiers)) return;
      editor.getContainer().dispatchEvent(
        new KeyboardEvent(down ? "keydown" : "keyup", { key, code, repeat: message.repeat === true, shiftKey: modifiers.shift, metaKey: modifiers.meta, ctrlKey: modifiers.ctrl, altKey: modifiers.alt, bubbles: true, cancelable: true }),
      );
      return;
    }
    if (message.type === "unframed:edit:context") {
      const id = typeof message.id === "string" ? message.id : null;
      const element = hostRef.current;
      if (id === null || element === null || typeof message.x !== "number" || typeof message.y !== "number") return;
      if (!current.selection.includes(id)) current.onFrameMessage({ type: "unframed:edit:pick", element: message.element, additive: false });
      const rect = element.getBoundingClientRect();
      const scale = element.offsetWidth === 0 ? 1 : rect.width / element.offsetWidth;
      setMenu({ id, x: rect.left + message.x * scale, y: rect.top + message.y * scale });
      return;
    }
    if (message.type === "unframed:edit:pointer") {
      if (typeof message.x === "number" && typeof message.y === "number") pointer.set({ x: message.x, y: message.y });
      return;
    }
    if (message.type === "unframed:edit:drag") {
      const key = String(message.key ?? "");
      const at = { x: Number(message.x), y: Number(message.y) };
      if (message.phase === "start") {
        const parent = layoutsRef.current[key]?.parent;
        const from = parent?.siblings.findIndex((sibling) => sibling.id === key) ?? -1;
        reorder.current = parent && isFlexLike(parent.display) && from >= 0 ? { id: key, from, axis: mainAxis(parent) } : null;
        return;
      }
      const held = reorder.current;
      if (held === null) return;
      if (message.phase === "end") reorder.current = null;
      const siblings = layoutsRef.current[held.id]?.parent?.siblings ?? [];
      if (siblings.length < 2 || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
      void current.structure({ kind: "moveTo", to: reorderIndex(siblings.map((sibling) => sibling.box), held.from, at, held.axis) }, [held.id]);
      return;
    }
    current.onFrameMessage(message);
    if (message.type === "unframed:edit:ready" && pendingPick.current !== undefined) {
      current.pickAt(pendingPick.current);
      pendingPick.current = undefined;
    }
  };
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const hooks = useMemo<ScreenEditHooks>(() => ({ onEdit: (message) => onEditRef.current(message as EditMessage), onEditReady: (post) => sessionRef.current.onFrameReady(post) }), []);

  useLayoutEffect(() => {
    const store = designHooksOf(project);
    store.set({ screen: shapeId, edit: hooks });
    return () => {
      if (store.get()?.edit === hooks) store.set(undefined);
    };
  }, [project, shapeId, hooks]);

  const selectionKey = session.selection.join(" ");
  useEffect(() => {
    if (selectionKey !== "") sessionRef.current.requestLive();
  }, [selectionKey]);

  const draftCount = session.drafts.length + (apply.run === undefined ? 0 : 1);
  useEffect(() => {
    designDraftsOf(project).set(draftCount);
  }, [project, draftCount]);
  useEffect(
    () => () => {
      designDraftsOf(project).set(0);
    },
    [project],
  );

  const draftKey = session.drafts.map((draft) => draft.element.stamp).join(" ");
  useEffect(() => {
    sessionRef.current.watch(draftKey === "" ? [] : [...new Set(draftKey.split(" "))]);
  }, [draftKey]);

  const host = useHost(project, shapeId);
  hostRef.current = host;
  const forAgent = (elements: ChipElement[]) => elements.map((element) => screenChip(element, session.reports[element.elementId ?? ""] ?? {}));

  if (props === undefined) return null;
  const view = { hovered: session.hovered, selection: session.selection, reports: session.reports, boxes: session.boxes, layouts };
  const [only] = session.selection;
  const single = session.selection.length === 1 && only !== undefined ? only : undefined;
  const singleBox = single === undefined ? undefined : boxOf(view, single);
  const singleLayout = single === undefined ? undefined : layouts[single];
  const chosen = selectionBox(view);
  const hoverId = session.hovered?.id ?? null;
  const hoverBox = hoverId === null || session.selection.includes(hoverId) ? undefined : boxOf(view, hoverId);
  return (
    <>
      {host !== null &&
        createPortal(
          <DesignOverlay view={view} badge={resizing ?? undefined}>
            {single !== undefined && singleBox !== undefined && singleLayout !== undefined && (
              <DesignHandles key={single} session={session} id={single} box={singleBox} layout={singleLayout} report={session.reports[single]} tokens={scaleFor(tokens, session.reports[single]?.className)} pointer={pointer} onResize={setResizing} />
            )}
            {alt && chosen !== undefined && hoverBox !== undefined && <AltDistance from={chosen} to={hoverBox} />}
          </DesignOverlay>,
          host,
        )}
      {host !== null && (
        <DesignDrafts host={host} container={editor.getContainer()} session={session} run={apply.run} project={project} picture={props.picture} size={{ w: props.w, h: props.h }} onApply={() => void apply.apply()} onDismiss={apply.clear} onDiscardAll={discardAll} />
      )}
      <DesignMenu at={menu} session={session} onClose={() => setMenu(undefined)} onCommand={(command) => run(command)} />
      <ScreenDesignPanel editor={editor} session={session} project={project} instance={instance?.id} onTell={(elements) => tellAgent(client, shapeId, forAgent(elements))} />
    </>
  );
};

const textStyle = (session: EditSession, id: string, style: Extract<DesignCommand, { kind: "text" }>["style"]) => {
  const computed = session.reports[id]?.computed ?? {};
  const inline = session.overrides.filter((step): step is ScreenOverride => "edit" in step && step.edit.elementId === id && step.edit.type === "style");
  const shown = (property: string): string => {
    const found = inline.find((override) => override.edit.type === "style" && override.edit.property === property);
    return found?.edit.type === "style" ? (found.edit.value ?? "") : (computed[property] ?? "");
  };
  const set = (property: string, value: string) => session.patch({ type: "style", elementId: id, property, value });
  if (style === "bold") set("font-weight", Number(shown("font-weight")) >= 600 ? "400" : "700");
  else if (style === "italic") set("font-style", shown("font-style") === "italic" ? "normal" : "italic");
  else if (style === "underline") set("text-decoration-line", shown("text-decoration-line").includes("underline") ? "none" : "underline");
  else if (style === "strike") set("text-decoration-line", shown("text-decoration-line").includes("line-through") ? "none" : "line-through");
  else if (style === "centre") set("text-align", shown("text-align") === "center" ? "left" : "center");
  else {
    const size = parseFloat(shown("font-size"));
    if (Number.isFinite(size)) set("font-size", `${Math.max(1, size + (style === "larger" ? 1 : -1))}px`);
  }
};

const ScreenDesignPanel = ({ editor, session, project, instance, onTell }: {
  readonly editor: Editor;
  readonly session: EditSession;
  readonly project: string;
  readonly instance: string | undefined;
  readonly onTell: (elements: ChipElement[]) => void;
}) => {
  const engine = useEngine();
  const ref = useRef<HTMLDivElement>(null);
  usePassThroughWheelEvents(ref);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const onPointerMove = (event: PointerEvent) => editor.markEventAsHandled(event);
    element.addEventListener("pointermove", onPointerMove);
    return () => element.removeEventListener("pointermove", onPointerMove);
  }, [editor]);
  const [only] = session.selection;
  const report = only === undefined ? undefined : session.reports[only];
  const title = session.selection.length > 1 ? `${session.selection.length} selected` : report === undefined ? "Design" : layerName(report);
  return createPortal(
    <div
      ref={ref}
      data-unframed-design-panel=""
      data-testid="screen-design-panel"
      aria-label="Design"
      role="region"
      className="pointer-events-auto absolute top-9 right-0 bottom-0 z-[calc(var(--tl-layer-watermark)_-_1)] box-border flex w-80 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-none border-l border-(--design-panel-border) bg-(--design-panel-surface) p-2.5 pb-14 font-sans text-(--design-panel-foreground) *:shrink-0"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-semibold" data-testid="screen-design-title">
          {title}
        </span>
        {report !== undefined && session.selection.length === 1 && <span className="shrink-0 text-xs text-(--design-panel-label)">{report.tag}</span>}
      </div>
      <DesignTab
        screen={{ engine, project, instance }}
        session={session}
        kind="screen"
        images={false}
        project={project}
        dials={NO_DIALS}
        locked={NONE}
        kit={null}
        mode={undefined}
        onOpenKit={() => undefined}
        onTell={onTell}
        onAsk={(_, elements) => onTell(elements)}
      />
    </div>,
    editor.getContainer(),
  );
};
