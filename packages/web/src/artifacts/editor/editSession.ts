/**
 * The editor's edit session (spec 18): the mode, the element selection, what the edit bridge
 * reports, the burst of source edits and its commit, undo within the session, and the prepare
 * that makes an older file editable. The frame is reached only through the edit protocol.
 */
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
  /** Set on a report after a patch: a stylesheet `!important` rule wins over the edited value. */
  readonly overridden?: boolean;
  /** A board copy's variant values, in the declaration's order (spec 20); null for any other element. */
  readonly variant?: Readonly<Record<string, string>> | null;
  /** An instance's pinned component: its declaration, and the live value of each declared attribute (spec 20). */
  readonly component?: {
    readonly tag: string;
    readonly sheet: string;
    readonly declaration: ComponentDeclaration;
    readonly attributes: Readonly<Record<string, string | null>>;
  };
  /** A board copy's rules that reach it, from its sheet's component style (spec 20); undefined for any other element. */
  readonly sheetRules?: ReadonlyArray<SheetRuleReport>;
}

/** A tween's live change for the frame (spec 21, Live preview): its target, its channels, and the values it changes. */
export interface TweenPatch {
  readonly selector: string;
  readonly channels: readonly string[];
  readonly change: {
    readonly start?: number;
    readonly duration?: number;
    readonly ease?: string;
    readonly stagger?: number;
    /** The values at one keyframe (`at` 0, 1 or a step), by property, as the frame shows them (static text or a number). */
    readonly values?: { readonly at: number; readonly props: Readonly<Record<string, string | number>> };
  };
}

export interface SourceTree {
  readonly ready: boolean;
  readonly elements: readonly SourceTreeElement[];
  /** The literals of the file that sit close to a kit token (spec 19); empty with no kit. */
  readonly offTokens: readonly OffTokenFound[];
}

/** An element of the frame's live tree (spec 18, `unframed:edit:tree`): `id` is null for a runtime element. */
export interface LiveNode {
  readonly id: string | null;
  readonly selector: string;
  readonly tag: string;
  readonly children: readonly LiveNode[];
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
  /** The project kit, which a token edit's preview reads (spec 19). */
  readonly kit: Kit | null;
}

export interface EditSession {
  readonly mode: EditMode;
  readonly setMode: (mode: EditMode) => void;
  /** The dial values the frame runs: the saved ones over the declared defaults, with the burst's held values. A dial-owned text is matched against them. */
  readonly showDials: (values: Readonly<Record<string, unknown>>) => void;
  readonly selection: readonly string[];
  readonly setSelection: (ids: readonly string[]) => void;
  /** The motion tween the timeline has selected, by its source order, or null. Part of the selection: a change commits the burst (spec 21, Rows). */
  readonly tween: number | null;
  readonly setTween: (index: number | null) => void;
  /** Selects the elements a style rule's selector matches in the frame (spec 19, Off-token values). */
  readonly selectMatching: (selector: string) => void;
  readonly hovered: EditReport | null;
  readonly reports: Readonly<Record<string, EditReport>>;
  /** The font families the document's elements use, first family of each, as the bridge reports them. */
  readonly families: readonly string[];
  readonly boxes: Readonly<Record<string, EditBox>>;
  /** The boxes of every copy of a selected or hovered board element, by its template id (spec 20). */
  readonly copies: Readonly<Record<string, readonly EditBox[]>>;
  readonly tree: SourceTree | undefined;
  /** The frame's live elements, for the Layers tab's runtime rows. Asked for when the frame is ready and on request. */
  readonly live: readonly LiveNode[];
  /** A motion's live tweens, as the bridge reports them after load and after each dials apply (spec 21). */
  readonly liveTweens: readonly LiveTween[];
  /** The declaration of a component sheet, as its frame reports it; null in a page or a motion (spec 20). */
  readonly declaration: ComponentDeclaration | null;
  /** Hovers an element from Layers: the frame outlines it. Null clears it. */
  readonly hoverLayer: (id: string | null) => void;
  /** The element a Layers row hovers, outlined in the frame. */
  readonly layerHover: string | null;
  /** Asks the frame for its live tree again. */
  readonly requestLive: () => void;
  /** Sets the locked elements the bridge and the next writes see. The shape's own write is the editor's. */
  readonly setLocked: (locked: readonly string[]) => void;
  readonly preparing: boolean;
  readonly prepareError: string | undefined;
  /** The source edits of the burst not yet written: they are the element's own, so the owner stays `source`. */
  readonly pending: readonly SourceEdit[];
  /**
   * The edits of the commit in progress, the file they were made on, and the file they were written to: the strip draws them over
   * the reading of the base until a newer reading is in (spec 21). Cleared when the shape goes back to the base, or on another file.
   */
  readonly settled: { readonly base: string; readonly result?: string; readonly edits: readonly SourceEdit[] } | undefined;
  /** The dial values the burst holds, by path. The frame shows them and they are written at commit. */
  readonly held: Readonly<Record<string, unknown>>;
  /** Holds a dial value from the Design tab: the burst writes it at commit, and no version is written for it alone. */
  readonly patchDial: (path: string, value: unknown) => void;
  /** The Parameters tab moved dials: a held value it changed is released, so the Parameters value wins. */
  readonly releaseDials: (values: Readonly<Record<string, unknown>>) => void;
  /** Elements a stylesheet `!important` rule wins over, as the bridge last reported them. */
  readonly overridden: Readonly<Record<string, boolean>>;
  readonly patch: (edit: SourceEdit) => void;
  /**
   * A motion tween's timing edit: collected into the burst as the edit, and shown in the frame at once as a tween patch.
   * Nothing is written until the burst commits (spec 21, Bursts).
   */
  readonly patchTween: (edit: SourceEdit, frame: TweenPatch) => void;
  /**
   * Shows a tween's timing in the frame without adding anything to the burst: a clip drag's carried tweens, which the clip's own
   * `clip-time` edit writes at the commit (spec 21, Live preview).
   */
  readonly previewTween: (frame: TweenPatch) => void;
  /**
   * Shows edits in the frame without adding them to the burst (a token's hover preview). The burst's
   * own edits are shown again over the reset frame; null shows only the burst.
   */
  readonly previewEdits: (edits: readonly SourceEdit[] | null) => void;
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
  // The dial values a commit is writing now: shown until the commit has answered.
  const inFlight = useRef<Readonly<Record<string, unknown>>>({});
  // The last source edit of each element, so a stylesheet that wins over it can take it back out of the burst.
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

  /** The held dial values: those a commit is writing, then those the burst still holds. */
  const heldNow = (): Readonly<Record<string, unknown>> => ({ ...inFlight.current, ...Object.fromEntries(burstRef.current.dials) });
  /** The shape's saved dial values, as the room has them. */
  /** The frame's dial values, set by the editor each render (see `showDials`). */
  const shownDials = useRef<Readonly<Record<string, unknown>>>({});
  /** The dial each element's in-place text writes, so a second text message still writes that dial. */
  const dialTextOf = useRef<Record<string, string>>({});
  const showDials = useCallback((values: Readonly<Record<string, unknown>>) => {
    shownDials.current = values;
  }, []);
  const shapeDials = (): Readonly<Record<string, unknown>> | undefined => (editor.getShape(shapeId as TLShapeId)?.props as { dials?: Record<string, unknown> } | undefined)?.dials;
  /** Once a burst holds nothing, it has no base file either, so the next edit starts a new one. */
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
      // A lock change is one step of the session's own undo history, as a committed edit is.
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
    // The edits stay on screen over the old reading while they are written, so the bars do not jump back at the commit.
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
    // Each commit is its own undo step, so Cmd-Z takes back one save at a time.
    if (edits.length === 0) {
      // Held dials alone write as one step, with no version.
      if (fileRef.current !== base) {
        finish();
        showNotice(conflictSentence(kind, "elsewhere"), "warning");
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
        showNotice(conflictSentence(kind, "elsewhere"), "warning");
        return;
      }
      // A burst begun while this commit was in flight was made on the file before it: it now rests on the new one.
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

  /**
   * Sends a burst to the engine. A `conflict` on the file this session set last is the room lagging the
   * editor, not another writer, so it is sent again for a few moments before it counts as a conflict.
   * The editor's own shape must still show that file: once it shows another, the change was a real one.
   */
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

  // Adds an edit to the burst and restarts the pause. A text edit typed in the frame is already on the page, so it is not posted back.
  const collect = useCallback(
    (edit: SourceEdit, showInFrame: boolean) => {
      burstRef.current = addToBurst(burstRef.current, edit);
      // A motion edit names a tween, not an element, so only element edits are remembered per element.
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
    // heldNow and settle read only refs.
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

  /** Whether an element is locked or sits inside a locked one, by the source tree's parents. */
  const lockedInside = (id: string): boolean => {
    for (let current: string | null = id; current !== null; ) {
      if (lockedRef.current.includes(current)) return true;
      current = treeRef.current?.elements.find((element) => element.id === current)?.parent ?? null;
    }
    return false;
  };

  /** The owner of an element's text as the frame's dials and the source say it: null for a runtime element. */
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

  /**
   * Whether a double-click may edit an element's text in place: the source holds it, or a dial does, whose
   * text the edit writes through the burst (spec 18). A text a script sets is read-only here.
   */
  const textEditable = (id: string): boolean => {
    if (lockedInside(id)) return false;
    if (burstEdits(burstRef.current).some((edit) => edit.type === "text" && edit.elementId === id)) return true;
    if (dialTextOf.current[id] !== undefined) return true;
    const owner = textOwnerOf(id);
    return owner !== null && (owner.owner === "source" || owner.owner === "dial");
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

  const selectMatching = useCallback((selector: string) => post({ type: "unframed:edit:selectMatching", selector }), [post]);

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
    // A motion's tween selection goes first, then the element selection (spec 21, Esc).
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
        // The bridge answers hello once it has loaded: it takes the mode, the locks and the selection now.
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
        if (Array.isArray(message.families)) setFamilies(message.families.filter((family): family is string => typeof family === "string"));
        setReports((previous) => {
          const next = { ...previous };
          for (const element of elements) if (element.id !== null) next[element.id] = element;
          return next;
        });
        // A patch report says, per element, whether a stylesheet rule wins over the value. That edit leaves the burst.
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
        // The boxes of every copy of each targeted board element: a copy outlines in every cell (spec 20).
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
        if (id !== null && modeRef.current === "edit" && textEditable(id)) post({ type: "unframed:edit:textEdit", id });
        return;
      }
      case "unframed:edit:text": {
        const id = typeof message.id === "string" ? message.id : null;
        const text = typeof message.text === "string" ? message.text : null;
        if (id === null || text === null) return;
        const burstText = burstEdits(burstRef.current).find((edit) => edit.type === "text" && edit.elementId === id);
        const shown = burstText?.type === "text" ? burstText.text : (reportsRef.current[id]?.text ?? null);
        // A text a dial holds writes the dial, as a Design edit does; the source's own text stays as it is.
        // The dial is remembered: once its text is held, the frame's text no longer matches the dial's value.
        const owner = burstText === undefined ? textOwnerOf(id) : null;
        const path = owner?.owner === "dial" ? owner.path : burstText === undefined ? dialTextOf.current[id] : undefined;
        if (path !== undefined) {
          dialTextOf.current[id] = path;
          if (text !== shown) patchDial(path, text);
          return;
        }
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

  // The edits a commit wrote stay drawn until the shape is back on their base (an undo) or on another file than the commit's.
  useEffect(() => {
    setSettled((previous) => (previous === undefined || file === previous.result || (file === previous.base && previous.result === undefined) ? previous : undefined));
  }, [file]);

  // The shape's file changed under a pending burst: the agent or another writer rewrote it. The burst is dropped
  // at once. Committing it now lets the engine answer the conflict and say who changed the file, and it writes nothing.
  useEffect(() => {
    const base = baseRef.current;
    if (base === undefined || file === base || file === "") return;
    void commit();
  }, [file]);

  // The source tree of the file, and the prepare that makes an older file editable (spec 18, The editor).
  useEffect(() => {
    if (file === "") return;
    let live = true;
    engine
      .call("artifact.sourceTree", { project, file })
      .then(async (answer) => {
        if (!live) return;
        setTree({ ready: answer.ready, elements: answer.elements, offTokens: answer.offTokens });
        if (answer.ready || preparedFor.current === file) return;
        preparedFor.current = file;
        setPreparing(true);
        try {
          const prepared = await engine.call("artifact.prepareEdit", { project, shapeId });
          // The engine points the shape at the prepared file itself, and only when it still shows this one, so the
          // swap stays out of the person's undo history and never lands over a newer version the agent wrote.
          if (!live) return;
          lastSet.current = prepared.file;
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
    showDials,
    selection,
    setSelection,
    tween,
    setTween,
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
