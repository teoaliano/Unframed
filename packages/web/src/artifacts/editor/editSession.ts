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
  addDraft,
  checkResolved,
  withResolved,
  addScreenOverride,
  draftOf,
  pickTarget,
  screenOverrideOf,
  screenSourceTree,
  undoScreenOverride,
  withoutEdit,
  STRUCTURAL_PROPERTY,
  structuralDraftOf,
  type EditorKind,
  type ScreenOverride,
  type DraftChange,
  type DraftElement,
  type DraftScope,
  type ResolvedElement,
  type Burst,
  type ComponentDeclaration,
  type Measured,
  type EditBox,
  type FieldOwner,
  type Kit,
  type TailwindToken,
  type StructuralEdit,
} from "@unframed/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc } from "../../canvas/doc.ts";
import type { EngineConnection } from "../../rpc/engine.ts";
import { messageOf } from "../../agent/store.ts";
import { expandShorthand } from "./expandShorthand.ts";
import { keepLateSave } from "./lateSaves.ts";
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
  readonly path?: string;
  readonly name?: string;
  readonly className?: string | null;
  readonly owner?: string | null;
  readonly source?: ElementSource | null;
}

export type ResolvedSource = ResolvedElement;
export type ElementSource = Omit<ResolvedElement, "source">;

export interface MeasureTarget {
  readonly stamp?: string;
  readonly key?: string;
  readonly index?: number;
  readonly selector?: string;
  readonly properties?: readonly string[];
  readonly attributes?: readonly string[];
}

interface TweenPatch {
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

interface SourceTree {
  readonly ready: boolean;
  readonly elements: readonly SourceTreeElement[];
  readonly offTokens: readonly OffTokenFound[];
}

export interface LiveNode {
  readonly id: string | null;
  readonly selector: string;
  readonly tag: string;
  readonly name?: string;
  readonly path?: string;
  readonly children: readonly LiveNode[];
}

const COMMIT_DELAY_MS = 1_500;
const HELLO_RETRY_MS = 250;
const HELLO_RETRIES = 60;

const LAG_RETRY_MS = 300;
const LAG_RETRIES = 12;

interface EditSessionInput {
  readonly doc: CanvasDoc;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly shapeId: string;
  readonly kind: EditorKind;
  readonly file: string;
  readonly locked: readonly string[];
  readonly kit: Kit | null;
  readonly editing: boolean;
  readonly target?: "file" | "screen";
  readonly onUndoEmpty?: () => void;
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
  readonly overrides: readonly ScreenOverride[];
  readonly drafts: readonly DraftChange[];
  readonly resolved: Readonly<Record<string, ResolvedSource | null>>;
  readonly resolve: (stamp: string, fresh?: boolean) => Promise<ResolvedSource | null>;
  readonly measure: (targets: readonly MeasureTarget[]) => Promise<readonly Measured[]>;
  readonly nextUpdate: (timeout: number) => Promise<boolean>;
  readonly discardDraft: (id: string) => void;
  readonly patchStructure: (elementId: string, edit: StructuralEdit) => void;
  readonly scopeDraft: (id: string, scope: DraftScope) => void;
  readonly showDrafts: (shown: boolean) => void;
  readonly patch: (edit: SourceEdit, token?: TailwindToken) => void;
  readonly patchTween: (edit: SourceEdit, frame: TweenPatch) => void;
  readonly previewTween: (frame: TweenPatch) => void;
  readonly previewEdits: (edits: readonly SourceEdit[] | null) => void;
  readonly commit: () => Promise<void>;
  readonly discard: (quiet?: boolean) => void;
  readonly handleKey: (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }) => boolean;
  readonly onFrameMessage: (message: EditMessage) => void;
  readonly onFrameReady: (post: (message: unknown) => void) => void;
}

const liveNodeOf = (nodes: readonly LiveNode[], id: string): LiveNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inside = liveNodeOf(node.children, id);
    if (inside !== undefined) return inside;
  }
  return undefined;
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

const conflictSentence = (kind: EditorKind, reason: unknown): string =>
  reason === "agent" ? "The agent rewrote this. Your last change wasn't saved." : `This ${kind} changed somewhere else. Your last change wasn't saved.`;

export const useEditSession = ({ doc, engine, project, shapeId, kind, file, locked, kit, editing, target = "file", onUndoEmpty }: EditSessionInput): EditSession => {
  const screen = target === "screen";
  const [mode, setModeState] = useState<EditMode>(editing ? "edit" : "interact");
  const [selection, setSelectionState] = useState<readonly string[]>([]);
  const [tween, setTweenState] = useState<number | null>(null);
  const tweenRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<EditReport | null>(null);
  const [reports, setReports] = useState<Readonly<Record<string, EditReport>>>({});
  const [families, setFamilies] = useState<readonly string[]>([]);
  const [boxes, setBoxes] = useState<Readonly<Record<string, EditBox>>>({});
  const [copies, setCopies] = useState<Readonly<Record<string, readonly EditBox[]>>>({});
  const [sourceTree, setTree] = useState<SourceTree | undefined>(undefined);
  const [live, setLive] = useState<readonly LiveNode[]>([]);
  const liveRef = useRef<readonly LiveNode[]>([]);
  liveRef.current = live;
  const [liveTweens, setLiveTweens] = useState<readonly LiveTween[]>([]);
  const [declaration, setDeclaration] = useState<ComponentDeclaration | null>(null);
  const [layerHover, setLayerHover] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<readonly SourceEdit[]>([]);
  const [settled, setSettled] = useState<{ base: string; result?: string; edits: readonly SourceEdit[] } | undefined>(undefined);
  const [held, setHeld] = useState<Readonly<Record<string, unknown>>>({});
  const [overridden, setOverridden] = useState<Readonly<Record<string, boolean>>>({});
  const [overrides, setOverridesState] = useState<readonly ScreenOverride[]>([]);
  const overridesRef = useRef<readonly ScreenOverride[]>([]);
  const undoEmptyTo = useRef(onUndoEmpty);
  undoEmptyTo.current = onUndoEmpty;
  const [drafts, setDraftsState] = useState<readonly DraftChange[]>([]);
  const draftFor = useRef(new Map<SourceEdit, DraftChange>());
  const structural = useRef<readonly DraftChange[]>([]);
  const scopes = useRef(new Map<string, DraftScope>());
  const [resolved, setResolved] = useState<Readonly<Record<string, ResolvedSource | null>>>({});
  const resolvedRef = useRef<Readonly<Record<string, ResolvedSource | null>>>({});
  const resolving = useRef(new Map<string, Promise<ResolvedSource | null>>());
  const unanswered = useRef(new Set<string>());
  const asks = useRef(new Map<number, (value: unknown) => void>());
  const nextAsk = useRef(0);
  const updateWaiters = useRef(new Set<() => void>());
  const screenTree = useMemo<SourceTree | undefined>(() => (screen ? { ready: true, elements: screenSourceTree(live, reports), offTokens: [] } : undefined), [screen, live, reports]);
  const tree = screen ? screenTree : sourceTree;
  const inFlight = useRef<Readonly<Record<string, unknown>>>({});
  const lastEdit = useRef<Record<string, SourceEdit>>({});

  const modeRef = useRef<EditMode>(editing ? "edit" : "interact");
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

  const withSource = (element: DraftElement): DraftElement => (element.source !== null ? element : withResolved(element, resolvedRef.current[element.stamp]));
  const deriveDrafts = () => {
    let list: DraftChange[] = [];
    for (const override of overridesRef.current) {
      const draft = draftFor.current.get(override.edit);
      if (draft !== undefined) list = addDraft(list, draft);
    }
    list = [...list, ...structural.current];
    setDraftsState(list.map((draft) => ({ ...draft, scope: scopes.current.get(draft.id) ?? draft.scope, element: withSource(draft.element) })));
  };
  const setOverrides = (next: readonly ScreenOverride[]) => {
    if (next === overridesRef.current || (next.length === 0 && overridesRef.current.length === 0)) return;
    overridesRef.current = next;
    setOverridesState(next);
    setPending(next.map((override) => override.edit));
    deriveDrafts();
  };
  const ask = <T,>(message: Record<string, unknown>, timeout: number, fallback: T): Promise<T> =>
    new Promise<T>((resolve) => {
      nextAsk.current += 1;
      const id = nextAsk.current;
      const timer = window.setTimeout(() => {
        asks.current.delete(id);
        resolve(fallback);
      }, timeout);
      asks.current.set(id, (value) => {
        window.clearTimeout(timer);
        asks.current.delete(id);
        resolve(value as T);
      });
      post({ ...message, id });
    });
  const resolve = (stamp: string, fresh = false): Promise<ResolvedSource | null> => {
    if (!fresh && !unanswered.current.has(stamp)) {
      const known = resolvedRef.current[stamp];
      if (known !== undefined) return Promise.resolve(known);
      const running = resolving.current.get(stamp);
      if (running !== undefined) return running;
    }
    const asked: Promise<ResolvedSource | null> = ask<ResolvedSource | null | undefined>({ type: "unframed:source:resolve", target: { stamp } }, 5_000, undefined).then((answer) => {
      if (resolving.current.get(stamp) === asked) resolving.current.delete(stamp);
      const found = answer ?? null;
      if (answer === undefined) unanswered.current.add(stamp);
      else unanswered.current.delete(stamp);
      resolvedRef.current = { ...resolvedRef.current, [stamp]: found };
      setResolved(resolvedRef.current);
      deriveDrafts();
      return found;
    });
    resolving.current.set(stamp, asked);
    return asked;
  };
  const measure = (targets: readonly MeasureTarget[]): Promise<readonly Measured[]> => ask<readonly Measured[]>({ type: "unframed:source:measure", targets }, 3_000, []);
  const nextUpdate = (timeout: number): Promise<boolean> =>
    new Promise<boolean>((done) => {
      const timer = window.setTimeout(() => {
        updateWaiters.current.delete(wake);
        done(false);
      }, timeout);
      const wake = () => {
        window.clearTimeout(timer);
        updateWaiters.current.delete(wake);
        done(true);
      };
      updateWaiters.current.add(wake);
    });
  const updated = () => {
    for (const wake of [...updateWaiters.current]) wake();
  };
  const draftKeyOf = (edit: SourceEdit): string => (edit.type === "style" ? edit.property : edit.type === "text" ? "#text" : "display");
  const draftElementOf = (stamp: string, known: { readonly name?: string; readonly tag: string; readonly path?: string; readonly selector: string }): DraftElement => {
    const source = checkResolved(reportsRef.current[stamp]?.source);
    return withSource({
      stamp,
      selector: known.path ?? known.selector,
      name: known.name ?? known.tag,
      tag: source?.tag ?? known.tag,
      key: source?.key ?? null,
      source: null,
      component: source?.owner ?? null,
      instanceIndex: source?.instanceIndex ?? 0,
      instanceCount: source?.instanceCount ?? 1,
      selfMapped: source?.selfMapped ?? false,
    });
  };
  const repaint = (list: readonly ScreenOverride[]) => {
    post({ type: "unframed:edit:reset" });
    const patches = list.flatMap((override) => framePatchesOf(override.edit, null));
    if (patches.length > 0) post({ type: "unframed:edit:patch", patches });
  };

  const heldNow = (): Readonly<Record<string, unknown>> => ({ ...inFlight.current, ...Object.fromEntries(burstRef.current.dials) });
  const shownDials = useRef<Readonly<Record<string, unknown>>>({});
  const dialTextOf = useRef<Record<string, string>>({});
  const showDials = useCallback((values: Readonly<Record<string, unknown>>) => {
    shownDials.current = values;
  }, []);
  const shapeDials = (): Readonly<Record<string, unknown>> | undefined => (doc.shape(shapeId)?.props as { dials?: Record<string, unknown> } | undefined)?.dials;
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

  const commitBurst = useCallback(async () => {
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
      doc.update(shapeId, { dials: dialsWith(shapeDials(), inFlight.current) }, "element edit");
      finish();
      undoable.current += 1;
      redoable.current = 0;
      return;
    }
    try {
      const answer = await send(base, edits);
      if (doc.isDisposed) {
        if (kind !== "screen") keepLateSave({ project, shapeId, kind, from: base, to: answer.file, held: dials.length > 0 ? { ...inFlight.current } : undefined });
        return;
      }
      if (fileRef.current !== base) {
        dropped();
        showNotice(conflictSentence(kind, await conflictReason(base)), "warning");
        return;
      }
      if (baseRef.current === base) baseRef.current = answer.file;
      const props = dials.length > 0 ? { file: answer.file, dials: dialsWith(shapeDials(), inFlight.current) } : { file: answer.file };
      doc.update(shapeId, props, "element edit");
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
  }, [doc, engine, kind, post, project, shapeId]);

  const flights = useRef(new Set<Promise<void>>());
  const commit = useCallback((): Promise<void> => {
    const run = commitBurst().catch(() => undefined);
    flights.current.add(run);
    void run.finally(() => flights.current.delete(run));
    return Promise.all([...flights.current]).then(() => undefined);
  }, [commitBurst]);

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
      if (screen && structural.current.length > 0) {
        structural.current = [];
        deriveDrafts();
      }
      if (screen && overridesRef.current.length > 0) {
        setOverrides([]);
        if (!quiet) post({ type: "unframed:edit:reset" });
        return;
      }
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
    (edit: SourceEdit, showInFrame: boolean, token?: TailwindToken) => {
      if (screen) {
        const id = "elementId" in edit ? edit.elementId : undefined;
        const known = id === undefined ? undefined : reportsRef.current[id] ?? liveNodeOf(liveRef.current, id);
        const override = known === undefined ? undefined : screenOverrideOf(edit, { name: known.name ?? known.tag, path: known.path ?? known.selector });
        if (override === undefined) return;
        lastEdit.current[override.edit.elementId] = edit;
        const report = reportsRef.current[override.edit.elementId];
        const draft = draftOf(edit, {
          id: `${override.edit.elementId}:${draftKeyOf(edit)}`,
          element: draftElementOf(override.edit.elementId, known!),
          className: report?.className ?? null,
          computed: report?.computed ?? {},
          text: report?.text ?? null,
        }, token);
        const earlier = draft === undefined ? undefined : overridesRef.current.map((each) => draftFor.current.get(each.edit)).find((each) => each?.id === draft.id);
        if (draft !== undefined) draftFor.current.set(edit, earlier === undefined ? draft : { ...draft, before: earlier.before, shownBefore: earlier.shownBefore });
        setOverrides(addScreenOverride(overridesRef.current, override));
        const patches = framePatchesOf(edit, null);
        if (showInFrame && patches.length > 0) post({ type: "unframed:edit:patch", patches });
        return;
      }
      burstRef.current = addToBurst(burstRef.current, edit);
      if ("elementId" in edit && edit.elementId !== undefined) lastEdit.current[edit.elementId] = edit;
      if (baseRef.current === undefined) baseRef.current = fileRef.current;
      setPending(burstEdits(burstRef.current));
      const patches = framePatchesOf(edit, kitRef.current);
      if (showInFrame && patches.length > 0) post({ type: "unframed:edit:patch", patches });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void commit(), COMMIT_DELAY_MS);
    },
    [commit, post, screen],
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

  const patch = useCallback((edit: SourceEdit, token?: TailwindToken) => collect(edit, true, token), [collect]);

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
      if (modeRef.current === next || (next === "edit" && !editing)) return;
      void commit();
      textPending.current = null;
      modeRef.current = next;
      setModeState(next);
      if (next === "interact") setHovered(null);
      post({ type: "unframed:edit:mode", mode: next, locked: lockedRef.current });
      if (screen && next === "edit") post({ type: "unframed:edit:tree" });
    },
    [commit, post, editing, screen],
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
      if (screen) for (const id of ids) void resolve(id);
    },
    [commit, post, screen],
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

  const shownFile = (): string | undefined => (doc.shape(shapeId)?.props as { file?: string } | undefined)?.file;

  const undo = () => {
    if (screen) {
      if (overridesRef.current.length === 0) {
        undoEmptyTo.current?.();
        return;
      }
      const next = undoScreenOverride(overridesRef.current);
      setOverrides(next);
      repaint(next);
      return;
    }
    if (baseRef.current !== undefined) {
      discard();
      return;
    }
    if (undoable.current === 0) return;
    undoable.current -= 1;
    redoable.current += 1;
    doc.undo();
    lastSet.current = shownFile();
  };

  const redo = () => {
    if (screen || redoable.current === 0) return;
    redoable.current -= 1;
    undoable.current += 1;
    doc.redo();
    lastSet.current = shownFile();
  };

  const handleKey = (key: string, modifiers: { readonly shift: boolean; readonly meta: boolean; readonly ctrl: boolean }): boolean => {
    const modified = modifiers.meta || modifiers.ctrl;
    if (modified && key.toLowerCase() === "z") {
      if (modifiers.shift) redo();
      else undo();
      return true;
    }
    if (modified || !editing) return false;
    if (screen && (key === "Backspace" || key === "Delete") && selectionRef.current.length > 0) return true;
    if (key.toLowerCase() === "v") {
      setMode("edit");
      return true;
    }
    if (key.toLowerCase() === "i") {
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
        if (screen) {
          updated();
          resolvedRef.current = {};
          resolving.current.clear();
          unanswered.current.clear();
          setResolved({});
          reportsRef.current = {};
          setReports({});
          setHovered(null);
          setOverrides([]);
          selectionRef.current = [];
          setSelectionState([]);
        }
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
        const nodes = Array.isArray(message.nodes) ? (message.nodes as LiveNode[]) : [];
        liveRef.current = nodes;
        setLive(nodes);
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
          if (edit !== undefined && screen) setOverrides(overridesRef.current.filter((override) => override.edit !== edit));
        }
        settle();
        setPending(screen ? overridesRef.current.map((override) => override.edit) : burstEdits(burstRef.current));
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
        if (screen && Array.isArray(message.levels)) {
          const levels = (message.levels as Array<{ id?: unknown }>).map((level) => ({ id: typeof level.id === "string" ? level.id : null }));
          setSelection(pickTarget({ levels, selection: selectionRef.current, clicks: typeof message.clicks === "number" ? message.clicks : 1, deepest: message.deepest === true, additive }));
          return;
        }
        if (additive) {
          const current = selectionRef.current;
          setSelection(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
        } else {
          setSelection([id]);
        }
        return;
      }
      case "unframed:source:resolved":
      case "unframed:source:measured": {
        const answer = typeof message.id === "number" ? asks.current.get(message.id) : undefined;
        answer?.(message.type === "unframed:source:resolved" ? checkResolved(message.element) : Array.isArray(message.results) ? message.results : []);
        return;
      }
      case "unframed:source:commit": {
        updated();
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
        if (modeRef.current !== "edit" && !/^[vi]$/i.test(key)) return;
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
    if (file === "" || !editing) return;
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
  }, [file, editing]);

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
    overrides,
    drafts,
    resolved,
    resolve,
    measure,
    nextUpdate,
    patchStructure: (elementId: string, edit: StructuralEdit) => {
      const known = reportsRef.current[elementId] ?? liveNodeOf(liveRef.current, elementId);
      if (!screen || known === undefined) return;
      const id = `${elementId}:${STRUCTURAL_PROPERTY[edit.type]}`;
      const earlier = structural.current.find((draft) => draft.id === id);
      const merged: StructuralEdit =
        edit.type === "props" && earlier?.kind === "props" ? { type: "props", props: { ...earlier.props, ...edit.props }, before: { ...edit.before, ...earlier.propsBefore } } : edit;
      const draft = structuralDraftOf(merged, { id, element: draftElementOf(elementId, known) });
      structural.current = [...structural.current.filter((each) => each.id !== id), draft];
      deriveDrafts();
    },
    discardDraft: (id: string) => {
      if (structural.current.some((draft) => draft.id === id)) {
        structural.current = structural.current.filter((draft) => draft.id !== id);
        deriveDrafts();
        return;
      }
      const next = overridesRef.current.filter((override) => draftFor.current.get(override.edit)?.id !== id);
      if (next.length === overridesRef.current.length) return;
      setOverrides(next);
      repaint(next);
    },
    scopeDraft: (id: string, scope: DraftScope) => {
      scopes.current.set(id, scope);
      deriveDrafts();
    },
    showDrafts: (shown: boolean) => {
      if (shown) repaint(overridesRef.current);
      else post({ type: "unframed:edit:reset" });
    },
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
