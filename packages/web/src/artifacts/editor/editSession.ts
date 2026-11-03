import type { OffTokenFound, SourceEdit, SourceTreeElement } from "@unframed/contracts";
import {
  addToBurst,
  burstDials,
  burstEdits,
  dialsWith,
  emptyBurst,
  fieldOwner,
  framePatchesOf,
  releaseDials as releaseHeldDials,
  withoutEdit,
  type ArtifactKind,
  type Burst,
  type ComponentDeclaration,
  type EditBox,
  type FieldOwner,
  type Kit,
} from "@unframed/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection } from "../../rpc/engine.ts";
import { messageOf } from "../../agent/store.ts";
import { expandShorthand } from "./expandShorthand.ts";
import { showError, showNotice } from "../../toasts.tsx";
import type { EditMessage } from "../ArtifactFrame.tsx";
import type { LiveTween } from "../timeline/rows.ts";
import type { SheetRuleReport } from "./sheetOwner.ts";

export type EditMode = "edit" | "interact";

export interface EditReport {
  readonly id: string | null;
  readonly selector: string;
  readonly tag: string;
  readonly box: EditBox;
  readonly text: string | null;
  readonly inline: Readonly<Record<string, string | null>>;
  readonly computed: Readonly<Record<string, string>>;
  readonly src: string | null;
  readonly animated: readonly string[];
  readonly overridden?: boolean;
  readonly variant?: Readonly<Record<string, string>> | null;
  readonly component?: {
    readonly tag: string;
    readonly sheet: string;
    readonly declaration: ComponentDeclaration;
    readonly attributes: Readonly<Record<string, string | null>>;
  };
  readonly sheetRules?: ReadonlyArray<SheetRuleReport>;
  readonly sheetOverrides?: ReadonlyArray<SheetRuleReport>;
}

export interface TweenPatch {
  readonly selector: string;
  readonly channels: readonly string[];
  readonly change: {
    readonly start?: number;
    readonly duration?: number;
    readonly ease?: string;
    readonly stagger?: number;
    readonly values?: { readonly at: number; readonly props: Readonly<Record<string, string | number>> };
  };
}

export interface SourceTree {
  readonly ready: boolean;
  readonly elements: readonly SourceTreeElement[];
  readonly offTokens: readonly OffTokenFound[];
}

export interface LiveNode {
  readonly id: string | null;
  readonly selector: string;
  readonly tag: string;
  readonly children: readonly LiveNode[];
}

export const COMMIT_DELAY_MS = 1_500;
const HELLO_RETRY_MS = 250;
const HELLO_RETRIES = 60;

const LAG_RETRY_MS = 300;
const LAG_RETRIES = 12;

export interface EditSessionInput {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly shapeId: string;
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly locked: readonly string[];
  readonly kit: Kit | null;
}

export interface EditSession {
  readonly mode: EditMode;
  readonly setMode: (mode: EditMode) => void;
  readonly showDials: (values: Readonly<Record<string, unknown>>) => void;
  readonly selection: readonly string[];
  readonly setSelection: (ids: readonly string[]) => void;
  readonly tween: number | null;
  readonly setTween: (index: number | null) => void;
  readonly selectMatching: (selector: string) => void;
  readonly hovered: EditReport | null;
  readonly reports: Readonly<Record<string, EditReport>>;
  readonly families: readonly string[];
  readonly boxes: Readonly<Record<string, EditBox>>;
  readonly copies: Readonly<Record<string, readonly EditBox[]>>;
  readonly tree: SourceTree | undefined;
  readonly live: readonly LiveNode[];
  readonly liveTweens: readonly LiveTween[];
  readonly declaration: ComponentDeclaration | null;
  readonly hoverLayer: (id: string | null) => void;
  readonly layerHover: string | null;
  readonly startText: (id: string) => void;
  readonly requestLive: () => void;
  readonly setLocked: (locked: readonly string[]) => void;
  readonly preparing: boolean;
  readonly prepareError: string | undefined;
  readonly pending: readonly SourceEdit[];
  readonly settled: { readonly base: string; readonly result?: string; readonly edits: readonly SourceEdit[] } | undefined;
  readonly held: Readonly<Record<string, unknown>>;
  readonly patchDial: (path: string, value: unknown) => void;
  readonly releaseDials: (values: Readonly<Record<string, unknown>>) => void;
  readonly overridden: Readonly<Record<string, boolean>>;
  readonly patch: (edit: SourceEdit) => void;
  readonly patchTween: (edit: SourceEdit, frame: TweenPatch) => void;
  readonly previewTween: (frame: TweenPatch) => void;
  readonly previewEdits: (edits: readonly SourceEdit[] | null) => void;
  readonly commit: () => Promise<void>;
  readonly discard: (quiet?: boolean) => void;
  readonly handleKey: (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }) => boolean;
  readonly onFrameMessage: (message: EditMessage) => void;
  readonly onFrameReady: (post: (message: unknown) => void) => void;
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

const conflictSentence = (kind: ArtifactKind, reason: unknown): string =>
  reason === "agent" ? "The agent rewrote this. Your last change wasn't saved." : `This ${kind} changed somewhere else. Your last change wasn't saved.`;

export const useEditSession = ({ editor, engine, project, shapeId, kind, file, locked, kit }: EditSessionInput): EditSession => {
  const [mode, setModeState] = useState<EditMode>("edit");
  const [selection, setSelectionState] = useState<readonly string[]>([]);
  const [tween, setTweenState] = useState<number | null>(null);
  const tweenRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<EditReport | null>(null);
  const [reports, setReports] = useState<Readonly<Record<string, EditReport>>>({});
  const [families, setFamilies] = useState<readonly string[]>([]);
  const [boxes, setBoxes] = useState<Readonly<Record<string, EditBox>>>({});
  const [copies, setCopies] = useState<Readonly<Record<string, readonly EditBox[]>>>({});
  const [tree, setTree] = useState<SourceTree | undefined>(undefined);
  const [live, setLive] = useState<readonly LiveNode[]>([]);
  const [liveTweens, setLiveTweens] = useState<readonly LiveTween[]>([]);
  const [declaration, setDeclaration] = useState<ComponentDeclaration | null>(null);
  const [layerHover, setLayerHover] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<readonly SourceEdit[]>([]);
  const [settled, setSettled] = useState<{ base: string; result?: string; edits: readonly SourceEdit[] } | undefined>(undefined);
  const [held, setHeld] = useState<Readonly<Record<string, unknown>>>({});
  const [overridden, setOverridden] = useState<Readonly<Record<string, boolean>>>({});
  const inFlight = useRef<Readonly<Record<string, unknown>>>({});
  const lastEdit = useRef<Record<string, SourceEdit>>({});

  const modeRef = useRef<EditMode>("edit");
  const selectionRef = useRef<readonly string[]>([]);
  const lockedRef = useRef<readonly string[]>(locked);
  lockedRef.current = locked;
  const fileRef = useRef(file);
  fileRef.current = file;
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const treeRef = useRef<SourceTree | undefined>(undefined);
  treeRef.current = tree;
  const reportsRef = useRef<Readonly<Record<string, EditReport>>>({});
  const postRef = useRef<((message: unknown) => void) | undefined>(undefined);
  const burstRef = useRef<Burst>(emptyBurst());
  const baseRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const undoable = useRef(0);
  const redoable = useRef(0);
  const preparedFor = useRef<string | undefined>(undefined);
  const preparingFile = useRef<string | undefined>(undefined);
  const helloTimer = useRef<number | undefined>(undefined);
  const textPending = useRef<string | null>(null);
  const awaitingText = useRef<string | null>(null);
  const lastSet = useRef<string | undefined>(undefined);

  const post = useCallback((message: unknown) => postRef.current?.(message), []);

  const heldNow = (): Readonly<Record<string, unknown>> => ({ ...inFlight.current, ...Object.fromEntries(burstRef.current.dials) });
  const shownDials = useRef<Readonly<Record<string, unknown>>>({});
  const dialTextOf = useRef<Record<string, string>>({});
  const showDials = useCallback((values: Readonly<Record<string, unknown>>) => {
    shownDials.current = values;
  }, []);
  const shapeDials = (): Readonly<Record<string, unknown>> | undefined => (editor.getShape(shapeId as TLShapeId)?.props as { dials?: Record<string, unknown> } | undefined)?.dials;
  const settle = () => {
    if (burstRef.current.edits.size > 0 || burstRef.current.dials.size > 0) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    baseRef.current = undefined;
  };
  const requestLive = useCallback(() => post({ type: "unframed:edit:tree" }), [post]);
  const hoverLayer = useCallback(
    (id: string | null) => {
      setLayerHover(id);
      post({ type: "unframed:edit:hover", id });
    },
    [post],
  );
  const setLocked = useCallback(
    (next: readonly string[]) => {
      lockedRef.current = next;
      post({ type: "unframed:edit:mode", mode: modeRef.current, locked: next });
      undoable.current += 1;
      redoable.current = 0;
    },
    [post],
  );

  const commit = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const base = baseRef.current;
    const edits = burstEdits(burstRef.current);
    const dials = burstDials(burstRef.current);
    if (base === undefined || (edits.length === 0 && dials.length === 0)) return;
    burstRef.current = emptyBurst();
    baseRef.current = undefined;
    setPending([]);
    if (edits.length > 0) setSettled({ base, edits });
    inFlight.current = Object.fromEntries(dials.map(({ path, value }) => [path, value]));
    const finish = () => {
      inFlight.current = {};
      setHeld(heldNow());
    };
    const dropped = () => {
      setSettled(undefined);
      finish();
    };
    if (edits.length === 0) {
      if (fileRef.current !== base) {
        finish();
        showNotice(conflictSentence(kind, await conflictReason(base)), "warning");
        return;
      }
      editor.markHistoryStoppingPoint("element edit");
      editor.updateShape({ id: shapeId as TLShapeId, type: kind, props: { dials: dialsWith(shapeDials(), inFlight.current) } } as never);
      finish();
      undoable.current += 1;
      redoable.current = 0;
      return;
    }
    try {
      const answer = await send(base, edits);
      if (fileRef.current !== base) {
        dropped();
        showNotice(conflictSentence(kind, await conflictReason(base)), "warning");
        return;
      }
      if (baseRef.current === base) baseRef.current = answer.file;
      editor.markHistoryStoppingPoint("element edit");
      const props = dials.length > 0 ? { file: answer.file, dials: dialsWith(shapeDials(), inFlight.current) } : { file: answer.file };
      editor.updateShape({ id: shapeId as TLShapeId, type: kind, props } as never);
      lastSet.current = answer.file;
      setSettled((previous) => (previous?.base === base ? { ...previous, result: answer.file } : previous));
      finish();
      undoable.current += 1;
      redoable.current = 0;
    } catch (error) {
      dropped();
      post({ type: "unframed:edit:reset" });
      const code = (error as { code?: unknown }).code;
      const details = (error as { details?: { reason?: unknown } }).details;
      if (code === "conflict") showNotice(conflictSentence(kind, details?.reason), "warning");
      else showError(messageOf(error));
    }
  }, [editor, engine, kind, post, project, shapeId]);

  const send = async (base: string, edits: SourceEdit[]): Promise<{ file: string }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await engine.call("artifact.edit", { project, shapeId, baseFile: base, edits });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        const reason = (error as { details?: { reason?: unknown } }).details?.reason;
        const lagging = code === "conflict" && reason !== "agent" && base === lastSet.current && shownFile() === base && attempt < LAG_RETRIES;
        if (!lagging) throw error;
        await new Promise((resolve) => setTimeout(resolve, LAG_RETRY_MS));
      }
    }
  };

  const conflictReason = async (base: string): Promise<unknown> => {
    try {
      await engine.call("artifact.edit", { project, shapeId, baseFile: base, edits: [] });
      return "elsewhere";
    } catch (error) {
      return (error as { details?: { reason?: unknown } }).details?.reason;
    }
  };

  const discard = useCallback(
    (quiet = false) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      if (baseRef.current === undefined && burstRef.current.edits.size === 0 && burstRef.current.dials.size === 0) return;
      burstRef.current = emptyBurst();
      baseRef.current = undefined;
      setPending([]);
      inFlight.current = {};
      setHeld({});
      if (!quiet) post({ type: "unframed:edit:reset" });
    },
    [post],
  );

  const collect = useCallback(
    (edit: SourceEdit, showInFrame: boolean) => {
      burstRef.current = addToBurst(burstRef.current, edit);
      if ("elementId" in edit && edit.elementId !== undefined) lastEdit.current[edit.elementId] = edit;
      if (baseRef.current === undefined) baseRef.current = fileRef.current;
      setPending(burstEdits(burstRef.current));
      const patches = framePatchesOf(edit, kitRef.current);
      if (showInFrame && patches.length > 0) post({ type: "unframed:edit:patch", patches });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void commit(), COMMIT_DELAY_MS);
    },
    [commit, post],
  );

  const patchDial = useCallback(
    (path: string, value: unknown) => {
      burstRef.current = addToBurst(burstRef.current, { type: "dial", path, value });
      if (baseRef.current === undefined) baseRef.current = fileRef.current;
      setHeld(heldNow());
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void commit(), COMMIT_DELAY_MS);
    },
    [commit],
  );

  const releaseDials = useCallback(
    (values: Readonly<Record<string, unknown>>) => {
      const before = burstRef.current.dials.size;
      burstRef.current = releaseHeldDials(burstRef.current, values);
      if (burstRef.current.dials.size === before) return;
      settle();
      setHeld(heldNow());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const patch = useCallback((edit: SourceEdit) => collect(edit, true), [collect]);

  const patchTween = useCallback(
    (edit: SourceEdit, frame: TweenPatch) => {
      collect(edit, false);
      post({ type: "unframed:edit:patch", patches: [{ kind: "tween", ...frame }] });
    },
    [collect, post],
  );

  const previewTween = useCallback((frame: TweenPatch) => post({ type: "unframed:edit:patch", patches: [{ kind: "tween", ...frame }] }), [post]);

  const previewEdits = useCallback(
    (edits: readonly SourceEdit[] | null) => {
      post({ type: "unframed:edit:reset" });
      const patches = [...burstEdits(burstRef.current), ...(edits ?? [])].flatMap((edit) => framePatchesOf(edit, kitRef.current));
      if (patches.length > 0) post({ type: "unframed:edit:patch", patches });
    },
    [post],
  );

  const lockedInside = (id: string): boolean => {
    for (let current: string | null = id; current !== null; ) {
      if (lockedRef.current.includes(current)) return true;
      current = treeRef.current?.elements.find((element) => element.id === current)?.parent ?? null;
    }
    return false;
  };

  const textOwnerOf = (id: string): FieldOwner | null => {
    const element = treeRef.current?.elements.find((candidate) => candidate.id === id);
    const report = reportsRef.current[id];
    if (element === undefined || report === undefined) return null;
    return fieldOwner({
      field: { kind: "text" },
      source: { inline: element.style, text: element.text, src: element.src ?? null },
      live: { inline: report.inline, text: report.text, src: report.src, animated: report.animated },
      dials: shownDials.current,
      locked: false,
      normalise: (value) => value,
      expand: expandShorthand,
    });
  };

  const textEditable = (id: string): boolean => {
    if (lockedInside(id)) return false;
    if (burstEdits(burstRef.current).some((edit) => edit.type === "text" && edit.elementId === id)) return true;
    if (dialTextOf.current[id] !== undefined) return true;
    const owner = textOwnerOf(id);
    return owner !== null && (owner.owner === "source" || owner.owner === "dial");
  };

  const startText = (id: string) => {
    const element = treeRef.current?.elements.find((candidate) => candidate.id === id);
    if (modeRef.current !== "edit" || element === undefined || element.text === null) return;
    if (reportsRef.current[id] === undefined) {
      awaitingText.current = id;
      return;
    }
    if (!textEditable(id)) return;
    textPending.current = id;
    post({ type: "unframed:edit:textEdit", id });
  };

  const setMode = useCallback(
    (next: EditMode) => {
      if (modeRef.current === next) return;
      void commit();
      textPending.current = null;
      modeRef.current = next;
      setModeState(next);
      if (next === "interact") setHovered(null);
      post({ type: "unframed:edit:mode", mode: next, locked: lockedRef.current });
    },
    [commit, post],
  );

  const selectMatching = useCallback((selector: string) => post({ type: "unframed:edit:selectMatching", selector }), [post]);

  const setSelection = useCallback(
    (ids: readonly string[]) => {
      if (sameIds(selectionRef.current, ids)) return;
      void commit();
      textPending.current = null;
      awaitingText.current = null;
      selectionRef.current = ids;
      setSelectionState(ids);
      post({ type: "unframed:edit:select", ids });
    },
    [commit, post],
  );

  const setTween = useCallback(
    (index: number | null) => {
      if (tweenRef.current === index) return;
      void commit();
      tweenRef.current = index;
      setTweenState(index);
    },
    [commit],
  );

  const shownFile = (): string | undefined => (editor.getShape(shapeId as TLShapeId)?.props as { file?: string } | undefined)?.file;

  const undo = () => {
    if (baseRef.current !== undefined) {
      discard();
      return;
    }
    if (undoable.current === 0) return;
    undoable.current -= 1;
    redoable.current += 1;
    editor.undo();
    lastSet.current = shownFile();
  };

  const redo = () => {
    if (redoable.current === 0) return;
    redoable.current -= 1;
    undoable.current += 1;
    editor.redo();
    lastSet.current = shownFile();
  };

  const handleKey = (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }): boolean => {
    const modified = modifiers.meta || modifiers.ctrl;
    if (modified && key.toLowerCase() === "z") {
      if (modifiers.shift) redo();
      else undo();
      return true;
    }
    if (modified) return false;
    if (key === "v" || key === "V") {
      setMode("edit");
      return true;
    }
    if (key === "i" || key === "I") {
      setMode("interact");
      return true;
    }
    if (key === "Enter" && modifiers.shift) {
      const [only] = selectionRef.current;
      const parent = selectionRef.current.length === 1 ? treeRef.current?.elements.find((element) => element.id === only)?.parent : undefined;
      if (parent) setSelection([parent]);
      return true;
    }
    if (key === "Escape" && tweenRef.current !== null) {
      setTween(null);
      return true;
    }
    if (key === "Escape" && selectionRef.current.length > 0) {
      setSelection([]);
      return true;
    }
    return false;
  };

  const onFrameMessage = (message: EditMessage) => {
    switch (message.type) {
      case "unframed:edit:ready": {
        window.clearInterval(helloTimer.current);
        helloTimer.current = undefined;
        post({ type: "unframed:edit:mode", mode: modeRef.current, locked: lockedRef.current });
        if (selectionRef.current.length > 0) post({ type: "unframed:edit:select", ids: selectionRef.current });
        post({ type: "unframed:edit:tree" });
        post({ type: "unframed:edit:tweens" });
        return;
      }
      case "unframed:edit:matched": {
        const ids = Array.isArray(message.ids) ? message.ids.filter((id): id is string => typeof id === "string") : [];
        setSelection(ids);
        return;
      }
      case "unframed:edit:tree": {
        setLive(Array.isArray(message.nodes) ? (message.nodes as LiveNode[]) : []);
        setDeclaration(typeof message.declaration === "object" && message.declaration !== null ? (message.declaration as ComponentDeclaration) : null);
        return;
      }
      case "unframed:edit:tweens": {
        setLiveTweens(Array.isArray(message.tweens) ? (message.tweens as LiveTween[]) : []);
        return;
      }
      case "unframed:edit:report": {
        const elements = Array.isArray(message.elements) ? (message.elements as EditReport[]) : [];
        for (const element of elements) if (element.id !== null) reportsRef.current = { ...reportsRef.current, [element.id]: element };
        if (awaitingText.current !== null && reportsRef.current[awaitingText.current] !== undefined) {
          const id = awaitingText.current;
          awaitingText.current = null;
          startText(id);
        }
        if (Array.isArray(message.families)) setFamilies(message.families.filter((family): family is string => typeof family === "string"));
        setReports((previous) => {
          const next = { ...previous };
          for (const element of elements) if (element.id !== null) next[element.id] = element;
          return next;
        });
        const judged = elements.filter((element) => element.id !== null && typeof element.overridden === "boolean");
        if (judged.length === 0) return;
        setOverridden((previous) => ({ ...previous, ...Object.fromEntries(judged.map((element) => [element.id!, element.overridden === true])) }));
        for (const element of judged) {
          const edit = element.overridden === true ? lastEdit.current[element.id!] : undefined;
          if (edit !== undefined) burstRef.current = withoutEdit(burstRef.current, edit);
        }
        settle();
        setPending(burstEdits(burstRef.current));
        setHeld(heldNow());
        return;
      }
      case "unframed:edit:boxes": {
        if (typeof message.boxes === "object" && message.boxes !== null) setBoxes(message.boxes as Record<string, EditBox>);
        return;
      }
      case "unframed:edit:copies": {
        if (typeof message.copies === "object" && message.copies !== null) setCopies(message.copies as Record<string, EditBox[]>);
        return;
      }
      case "unframed:edit:hover": {
        const element = (message.element ?? null) as EditReport | null;
        setHovered(element !== null && element.id !== null ? element : null);
        return;
      }
      case "unframed:edit:pick": {
        const element = (message.element ?? null) as EditReport | null;
        const additive = message.additive === true;
        if (element === null || element.id === null) {
          if (!additive) setSelection([]);
          return;
        }
        const id = element.id;
        reportsRef.current = { ...reportsRef.current, [id]: element };
        setReports((previous) => ({ ...previous, [id]: element }));
        if (additive) {
          const current = selectionRef.current;
          setSelection(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
        } else {
          setSelection([id]);
        }
        return;
      }
      case "unframed:edit:textStart": {
        const id = typeof message.id === "string" ? message.id : null;
        if (id !== null) startText(id);
        return;
      }
      case "unframed:edit:text": {
        const id = typeof message.id === "string" ? message.id : null;
        const text = typeof message.text === "string" ? message.text : null;
        if (id === null || text === null || textPending.current !== id) return;
        textPending.current = null;
        const burstText = burstEdits(burstRef.current).find((edit) => edit.type === "text" && edit.elementId === id);
        const shown = burstText?.type === "text" ? burstText.text : (reportsRef.current[id]?.text ?? null);
        const owner = burstText === undefined ? textOwnerOf(id) : null;
        const path = owner?.owner === "dial" ? owner.path : burstText === undefined ? dialTextOf.current[id] : undefined;
        if (path !== undefined) {
          dialTextOf.current[id] = path;
          if (text !== shown) patchDial(path, text);
          return;
        }
        if (text !== shown) collect({ type: "text", elementId: id, text }, false);
        return;
      }
      case "unframed:edit:key": {
        const key = String(message.key ?? "");
        if (modeRef.current !== "edit" && key !== "v" && key !== "V" && key !== "i" && key !== "I") return;
        const modifiers = { shift: message.shift === true, meta: message.meta === true, ctrl: message.ctrl === true };
        if (key === "Enter" && !modifiers.shift && !modifiers.meta && !modifiers.ctrl) {
          const [only] = selectionRef.current;
          if (selectionRef.current.length === 1 && only !== undefined) startText(only);
          return;
        }
        handleKey(key, modifiers);
        return;
      }
      default:
        return;
    }
  };

  const lockKey = locked.join("\n");
  useEffect(() => {
    post({ type: "unframed:edit:mode", mode: modeRef.current, locked: lockedRef.current });
  }, [lockKey, post]);

  const treeBefore = useRef<SourceTree | undefined>(undefined);
  useEffect(() => {
    const before = treeBefore.current;
    treeBefore.current = tree;
    if (before === undefined || tree === undefined || before === tree) return;
    const now = new Set(tree.elements.map((element) => element.id));
    const gone = new Set(before.elements.map((element) => element.id));
    const kept = selectionRef.current.filter((id) => now.has(id) || !gone.has(id));
    if (kept.length !== selectionRef.current.length) setSelection(kept);
  }, [tree]);

  useEffect(() => {
    setSettled((previous) => (previous === undefined || file === previous.result || (file === previous.base && previous.result === undefined) ? previous : undefined));
  }, [file]);

  useEffect(() => {
    const base = baseRef.current;
    if (base === undefined || file === base || file === "") return;
    void commit();
  }, [file]);

  useEffect(() => {
    if (file === "") return;
    if (preparingFile.current !== undefined && file !== preparingFile.current) {
      preparingFile.current = undefined;
      setPreparing(false);
    }
    let live = true;
    engine
      .call("artifact.sourceTree", { project, file })
      .then(async (answer) => {
        if (!live) return;
        setTree({ ready: answer.ready, elements: answer.elements, offTokens: answer.offTokens });
        if (answer.ready || preparedFor.current === file) return;
        preparedFor.current = file;
        preparingFile.current = file;
        setPreparing(true);
        try {
          const prepared = await engine.call("artifact.prepareEdit", { project, shapeId });
          lastSet.current = prepared.file;
          if (fileRef.current !== file && preparingFile.current === file) {
            preparingFile.current = undefined;
            setPreparing(false);
          }
        } catch (error) {
          if (preparingFile.current === file) {
            preparingFile.current = undefined;
            setPreparing(false);
          }
          if (!live) return;
          setPrepareError(messageOf(error));
          setMode("interact");
        }
      })
      .catch((error: unknown) => {
        if (live) setPrepareError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [file]);

  return {
    mode,
    setMode,
    showDials,
    selection,
    setSelection,
    tween,
    setTween,
    startText,
    selectMatching,
    hovered,
    reports,
    families,
    boxes,
    copies,
    tree,
    live,
    liveTweens,
    declaration,
    hoverLayer,
    layerHover,
    requestLive,
    setLocked,
    preparing,
    prepareError,
    pending,
    settled,
    held,
    patchDial,
    releaseDials,
    overridden,
    patch,
    patchTween,
    previewTween,
    previewEdits,
    commit,
    discard,
    handleKey,
    onFrameMessage,
    onFrameReady: (send) => {
      postRef.current = send;
      window.clearInterval(helloTimer.current);
      let tries = 0;
      helloTimer.current = window.setInterval(() => {
        tries += 1;
        if (tries > HELLO_RETRIES) {
          window.clearInterval(helloTimer.current);
          helloTimer.current = undefined;
          return;
        }
        send({ type: "unframed:edit:hello" });
      }, HELLO_RETRY_MS);
    },
  };
};
