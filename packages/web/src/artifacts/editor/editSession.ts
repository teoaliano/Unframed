/**
 * The editor's edit session (spec 18): the mode, the element selection, what the edit bridge
 * reports, the burst of source edits and its commit, undo within the session, and the prepare
 * that makes an older file editable. The frame is reached only through the edit protocol.
 */
import type { SourceEdit, SourceTreeElement } from "@unframed/contracts";
import { addToBurst, burstEdits, emptyBurst, fieldOwner, type ArtifactKind, type Burst, type EditBox } from "@unframed/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import type { EngineConnection } from "../../rpc/engine.ts";
import { messageOf } from "../../agent/store.ts";
import { showError, showNotice } from "../../toasts.tsx";
import type { EditMessage } from "../ArtifactFrame.tsx";

export type EditMode = "edit" | "interact";

/** The bridge's element report (spec 18, `ElementReport`): what it shows of one element. */
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
}

export interface SourceTree {
  readonly ready: boolean;
  readonly elements: readonly SourceTreeElement[];
}

/** The burst waits this long after its last edit, then commits (spec 18, Bursts). */
export const COMMIT_DELAY_MS = 1_500;
/**
 * The edit hello is said again until the bridge answers: a motion's composition can load after the
 * first hello, which the viewer would then drop. A bridge that is already loaded answers each one.
 */
const HELLO_RETRY_MS = 250;
const HELLO_RETRIES = 60;

/** How often, and how many times, a commit waits for the room to catch up with a file this session set. */
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
}

export interface EditSession {
  readonly mode: EditMode;
  readonly setMode: (mode: EditMode) => void;
  readonly selection: readonly string[];
  readonly setSelection: (ids: readonly string[]) => void;
  readonly hovered: EditReport | null;
  readonly reports: Readonly<Record<string, EditReport>>;
  /** The font families the document's elements use, first family of each, as the bridge reports them. */
  readonly families: readonly string[];
  readonly boxes: Readonly<Record<string, EditBox>>;
  readonly tree: SourceTree | undefined;
  readonly preparing: boolean;
  readonly prepareError: string | undefined;
  /** The source edits of the burst not yet written: they are the element's own, so the owner stays `source`. */
  readonly pending: readonly SourceEdit[];
  readonly patch: (edit: SourceEdit) => void;
  readonly commit: () => Promise<void>;
  /** Drops the burst and puts the frame back, or with `quiet`, drops it without touching the frame (its artifact is gone). */
  readonly discard: (quiet?: boolean) => void;
  /** Handles a key the editor owns. Answers false when the key is not the editor's, so the caller can act on it. */
  readonly handleKey: (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }) => boolean;
  /** Takes a message the frame sent. */
  readonly onFrameMessage: (message: EditMessage) => void;
  /** Hands the session the way to post to the frame, each time the frame loads. */
  readonly onFrameReady: (post: (message: unknown) => void) => void;
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

const conflictSentence = (kind: ArtifactKind, reason: unknown): string =>
  reason === "agent" ? "The agent rewrote this. Your last change wasn't saved." : `This ${kind} changed somewhere else. Your last change wasn't saved.`;

export const useEditSession = ({ editor, engine, project, shapeId, kind, file, locked }: EditSessionInput): EditSession => {
  const [mode, setModeState] = useState<EditMode>("edit");
  const [selection, setSelectionState] = useState<readonly string[]>([]);
  const [hovered, setHovered] = useState<EditReport | null>(null);
  const [reports, setReports] = useState<Readonly<Record<string, EditReport>>>({});
  const [families, setFamilies] = useState<readonly string[]>([]);
  const [boxes, setBoxes] = useState<Readonly<Record<string, EditBox>>>({});
  const [tree, setTree] = useState<SourceTree | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<readonly SourceEdit[]>([]);

  const modeRef = useRef<EditMode>("edit");
  const selectionRef = useRef<readonly string[]>([]);
  const lockedRef = useRef<readonly string[]>(locked);
  lockedRef.current = locked;
  const fileRef = useRef(file);
  fileRef.current = file;
  const treeRef = useRef<SourceTree | undefined>(undefined);
  treeRef.current = tree;
  // The reports as the frame last sent them, read at once by a text edit that starts in the same click.
  const reportsRef = useRef<Readonly<Record<string, EditReport>>>({});
  const postRef = useRef<((message: unknown) => void) | undefined>(undefined);
  const burstRef = useRef<Burst>(emptyBurst());
  // The file the burst began on; undefined while no burst is collecting.
  const baseRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  // Edits this session made that undo and redo may still take back.
  const undoable = useRef(0);
  const redoable = useRef(0);
  const preparedFor = useRef<string | undefined>(undefined);
  const helloTimer = useRef<number | undefined>(undefined);
  // The file this session last set on the shape. The room learns of it a sync round later, so a commit
  // that follows at once can reach the engine with a base the room has not caught up to yet.
  const lastSet = useRef<string | undefined>(undefined);

  const post = useCallback((message: unknown) => postRef.current?.(message), []);

  const commit = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const base = baseRef.current;
    const edits = burstEdits(burstRef.current);
    if (base === undefined || edits.length === 0) return;
    burstRef.current = emptyBurst();
    baseRef.current = undefined;
    setPending([]);
    try {
      const answer = await send(base, edits);
      if (fileRef.current !== base) {
        showNotice(conflictSentence(kind, "elsewhere"), "warning");
        return;
      }
      // Each commit is its own undo step, so Cmd-Z takes back one save at a time.
      editor.markHistoryStoppingPoint("element edit");
      editor.updateShape({ id: shapeId as TLShapeId, type: kind, props: { file: answer.file } } as never);
      lastSet.current = answer.file;
      undoable.current += 1;
      redoable.current = 0;
    } catch (error) {
      post({ type: "unframed:edit:reset" });
      const code = (error as { code?: unknown }).code;
      const details = (error as { details?: { reason?: unknown } }).details;
      if (code === "conflict") showNotice(conflictSentence(kind, details?.reason), "warning");
      else showError(messageOf(error));
    }
  }, [editor, engine, kind, post, project, shapeId]);

  /**
   * Sends a burst to the engine. A `conflict` on the file this session set last is the room lagging the
   * editor, not another writer, so it is sent again for a few moments before it counts as a conflict.
   */
  const send = async (base: string, edits: SourceEdit[]): Promise<{ file: string }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await engine.call("artifact.edit", { project, shapeId, baseFile: base, edits });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        const reason = (error as { details?: { reason?: unknown } }).details?.reason;
        const lagging = code === "conflict" && reason !== "agent" && base === lastSet.current && attempt < LAG_RETRIES;
        if (!lagging) throw error;
        await new Promise((resolve) => setTimeout(resolve, LAG_RETRY_MS));
      }
    }
  };

  const discard = useCallback(
    (quiet = false) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      if (baseRef.current === undefined && burstRef.current.edits.size === 0) return;
      burstRef.current = emptyBurst();
      baseRef.current = undefined;
      setPending([]);
      if (!quiet) post({ type: "unframed:edit:reset" });
    },
    [post],
  );

  // Adds an edit to the burst and restarts the pause. A text edit typed in the frame is already on the page, so it is not posted back.
  const collect = useCallback(
    (edit: SourceEdit, showInFrame: boolean) => {
      burstRef.current = addToBurst(burstRef.current, edit);
      if (baseRef.current === undefined) baseRef.current = fileRef.current;
      setPending(burstEdits(burstRef.current));
      if (showInFrame) post({ type: "unframed:edit:patch", patches: [edit] });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void commit(), COMMIT_DELAY_MS);
    },
    [commit, post],
  );

  const patch = useCallback((edit: SourceEdit) => collect(edit, true), [collect]);

  /** Whether an element is locked or sits inside a locked one, by the source tree's parents. */
  const lockedInside = (id: string): boolean => {
    for (let current: string | null = id; current !== null; ) {
      if (lockedRef.current.includes(current)) return true;
      current = treeRef.current?.elements.find((element) => element.id === current)?.parent ?? null;
    }
    return false;
  };

  /**
   * Whether a double-click may edit an element's text in place: the owner rule says the source holds it.
   * A text a script sets, or a text a dial sets, is read-only here (a dial's text waits for the dial write).
   */
  const textEditable = (id: string): boolean => {
    if (lockedInside(id)) return false;
    if (burstEdits(burstRef.current).some((edit) => edit.type === "text" && edit.elementId === id)) return true;
    const element = treeRef.current?.elements.find((candidate) => candidate.id === id);
    const report = reportsRef.current[id];
    if (element === undefined || report === undefined) return false;
    const owner = fieldOwner({
      field: { kind: "text" },
      source: { inline: element.style, text: element.text, src: element.src ?? null },
      live: { inline: report.inline, text: report.text, src: report.src, animated: report.animated },
      dials: {},
      locked: false,
      normalise: (value) => value,
    });
    return owner.owner === "source";
  };

  const setMode = useCallback(
    (next: EditMode) => {
      if (modeRef.current === next) return;
      void commit();
      modeRef.current = next;
      setModeState(next);
      if (next === "interact") setHovered(null);
      post({ type: "unframed:edit:mode", mode: next, locked: lockedRef.current });
    },
    [commit, post],
  );

  const setSelection = useCallback(
    (ids: readonly string[]) => {
      if (sameIds(selectionRef.current, ids)) return;
      void commit();
      selectionRef.current = ids;
      setSelectionState(ids);
      post({ type: "unframed:edit:select", ids });
    },
    [commit, post],
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
    if (key === "Escape" && selectionRef.current.length > 0) {
      setSelection([]);
      return true;
    }
    return false;
  };

  const onFrameMessage = (message: EditMessage) => {
    switch (message.type) {
      case "unframed:edit:ready": {
        // The bridge answers hello once it has loaded: it takes the mode, the locks and the selection now.
        window.clearInterval(helloTimer.current);
        helloTimer.current = undefined;
        post({ type: "unframed:edit:mode", mode: modeRef.current, locked: lockedRef.current });
        if (selectionRef.current.length > 0) post({ type: "unframed:edit:select", ids: selectionRef.current });
        return;
      }
      case "unframed:edit:report": {
        const elements = Array.isArray(message.elements) ? (message.elements as EditReport[]) : [];
        for (const element of elements) if (element.id !== null) reportsRef.current = { ...reportsRef.current, [element.id]: element };
        if (Array.isArray(message.families)) setFamilies(message.families.filter((family): family is string => typeof family === "string"));
        setReports((previous) => {
          const next = { ...previous };
          for (const element of elements) if (element.id !== null) next[element.id] = element;
          return next;
        });
        return;
      }
      case "unframed:edit:boxes": {
        if (typeof message.boxes === "object" && message.boxes !== null) setBoxes(message.boxes as Record<string, EditBox>);
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
        if (id !== null && modeRef.current === "edit" && textEditable(id)) post({ type: "unframed:edit:textEdit", id });
        return;
      }
      case "unframed:edit:text": {
        const id = typeof message.id === "string" ? message.id : null;
        const text = typeof message.text === "string" ? message.text : null;
        if (id === null || text === null) return;
        const burstText = burstEdits(burstRef.current).find((edit) => edit.type === "text" && edit.elementId === id);
        const shown = burstText?.type === "text" ? burstText.text : (reportsRef.current[id]?.text ?? null);
        // Leaving a text unchanged is not an edit, so it writes no version.
        if (text !== shown) collect({ type: "text", elementId: id, text }, false);
        return;
      }
      case "unframed:edit:key": {
        handleKey(String(message.key ?? ""), { shift: message.shift === true, meta: message.meta === true, ctrl: message.ctrl === true });
        return;
      }
      default:
        return;
    }
  };

  // The source tree of the file, and the prepare that makes an older file editable (spec 18, The editor).
  useEffect(() => {
    if (file === "") return;
    let live = true;
    engine
      .call("artifact.sourceTree", { project, file })
      .then(async (answer) => {
        if (!live) return;
        setTree({ ready: answer.ready, elements: answer.elements });
        if (answer.ready || preparedFor.current === file) return;
        preparedFor.current = file;
        setPreparing(true);
        try {
          const prepared = await engine.call("artifact.prepareEdit", { project, shapeId });
          if (!live) return;
          if (prepared.file !== fileRef.current) {
            // The swap is not a person's change, so it stays out of their undo history.
            editor.run(() => editor.updateShape({ id: shapeId as TLShapeId, type: kind, props: { file: prepared.file } } as never), { history: "ignore" });
            lastSet.current = prepared.file;
          }
        } catch (error) {
          if (!live) return;
          setPrepareError(messageOf(error));
          setMode("interact");
        } finally {
          if (live) setPreparing(false);
        }
      })
      .catch((error: unknown) => {
        if (live) setPrepareError(messageOf(error));
      });
    return () => {
      live = false;
    };
    // The file is the key: a new file is a new document to read.
  }, [file]);

  return {
    mode,
    setMode,
    selection,
    setSelection,
    hovered,
    reports,
    families,
    boxes,
    tree,
    preparing,
    prepareError,
    pending,
    patch,
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
