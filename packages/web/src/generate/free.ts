/**
 * Free (spec 05): the Runs value that takes its count from a list in the selection. The
 * pipeline mints the batch id, splits the list, repairs it with one text call when it is
 * not already a list, builds the batch with the domain's Free batch, and either sends it or
 * stages it for the final prompt dialog. Everything after the list text is in hand is the
 * one pure Free batch call, so what the dialog shows is what gets sent.
 */
import { resultMetaOf, type ImageParams, type RecipeRef } from "@unframed/contracts";
import {
  composeSelection,
  freeBatch,
  freeNotes,
  freeSource,
  repairNote,
  repairSystemPrompt,
  repairUserTurn,
  splitList,
  type FreeBatch,
  type Slot,
} from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { canvasShapes, selectionBox } from "./facts.ts";
import type { RunSource, SendInput } from "./mediumRegistry.ts";
import { referencesFor } from "./render.ts";
import { noteBatch } from "./runReports.ts";
import { viewsFinalPrompt } from "./runsProp.tsx";

export const NO_FREE_SOURCE = 'Select a prompt or a text result. Each item turns into one generation: a "---" separated list, or prose a text model can split.';
export const EMPTY_TEXT_RESULT = "The text result is empty. It lists what to generate.";
export const EMPTY_PROMPT = "The prompt is empty. It lists what to generate.";
export const NO_SECTIONS = "That list has no sections to run.";

/** `b-<epochMs>`: a batch's id, minted by the web at send. */
export const mintBatchId = (): string => `b-${Date.now()}`;

/** What stops a Free send before anything is paid for. */
export const freeBlockers = (source: RunSource): string[] => {
  if (source.kind !== "selection") return [NO_FREE_SOURCE];
  const found = freeSource(source);
  if (found.source === undefined) return [NO_FREE_SOURCE];
  if (found.error !== undefined) return [found.error];
  if (source.composition.error !== undefined) return [source.composition.error];
  if (found.listText.trim() === "") return [found.source.textResult ? EMPTY_TEXT_RESULT : EMPTY_PROMPT];
  return [];
};

/** A batch between its repair call and its send: what the final prompt dialog edits and confirms. */
export interface StagedFree {
  readonly project: string;
  readonly batchId: string;
  readonly sourceId: string;
  /** The list as the pipeline has it: the repaired text when the repair was used, the source's otherwise. */
  readonly listText: string;
  /** The list is the repair's answer, so Free batch reads it literally. */
  readonly repaired: boolean;
  /** The box's text as typed. */
  readonly instruction: string;
  readonly repairNotes: ReadonlyArray<string>;
  /** The repair call's cost, counted once in the batch. */
  readonly extraCost: number | undefined;
  readonly model: string | undefined;
  readonly params: ImageParams;
  /** Composites and sketches already rendered and uploaded, by slot: one Generate writes each once. */
  readonly rendered: Map<string, RecipeRef>;
}

const staged = new WeakMap<Editor, Atom<StagedFree | undefined>>();

/** The batch staged for the final prompt dialog, if any. It lives only in this tab. */
export const stagedFree = (editor: Editor): Atom<StagedFree | undefined> => {
  let value = staged.get(editor);
  if (!value) {
    value = atom<StagedFree | undefined>("staged free batch", undefined);
    staged.set(editor, value);
  }
  return value;
};

const slotKey = (slot: Slot) => `${slot.kind}:${JSON.stringify(slot.source)}`;

/** Renders and uploads the slots not rendered yet, and answers every slot's reference. */
const renderSlots = async (editor: Editor, project: string, slots: ReadonlyArray<Slot>, rendered: Map<string, RecipeRef>): Promise<RecipeRef[]> => {
  const missing = slots.filter((slot, index) => !rendered.has(slotKey(slot)) && slots.findIndex((each) => slotKey(each) === slotKey(slot)) === index);
  const refs = await referencesFor(editor, project, missing);
  missing.forEach((slot, index) => rendered.set(slotKey(slot), refs[index]!));
  return slots.map((slot) => rendered.get(slotKey(slot))!);
};

/** The batch a list text makes against the canvas as it is now. */
export const batchNow = (editor: Editor, stage: Pick<StagedFree, "sourceId" | "instruction" | "repaired">, listText: string): FreeBatch =>
  freeBatch({
    shapes: canvasShapes(editor),
    selected: editor.getSelectedShapeIds(),
    instruction: stage.instruction,
    sourceId: stage.sourceId,
    listText,
    repaired: stage.repaired,
  });

/** Sends a built batch as one image run with the staged batch id, its notes kept for the run report. */
export const sendBatch = async (editor: Editor, engine: EngineConnection, stage: StagedFree, batch: FreeBatch): Promise<{ batchId: string }> => {
  if (batch.error !== undefined) throw new Error(batch.error);
  if (batch.runs.length === 0) throw new Error(NO_SECTIONS);
  const selected = editor.getSelectedShapeIds();
  const live = composeSelection({ shapes: canvasShapes(editor), selected, instruction: stage.instruction, medium: "image" });
  const outputs = [];
  for (const run of batch.runs) {
    outputs.push({
      prompt: run.prompt,
      references: await renderSlots(editor, stage.project, run.references, stage.rendered),
      selectionPrompt: run.selectionPrompt,
      free: { picks: run.picks === null ? null : [...run.picks], dropped: [...run.dropped] },
    });
  }
  noteBatch(stage.batchId, freeNotes(batch, stage.repairNotes));
  return engine.call("run.image", {
    project: stage.project,
    batchId: stage.batchId,
    ...(stage.model === undefined ? {} : { model: stage.model }),
    params: stage.params,
    selectionPrompt: batch.shared,
    instruction: batch.instruction,
    outputs,
    sources: [...live.sources],
    anchor: selectionBox(editor, selected as TLShapeId[]) ?? { x: 0, y: 0, w: 0, h: 0 },
    ...(stage.extraCost === undefined ? {} : { batchExtraCost: stage.extraCost }),
  });
};

/**
 * The Free send: the list from the selection, one repair call when it holds fewer than two
 * sections, then the batch, sent or staged for the final prompt dialog (`"stay"`). `params`
 * are the image params the tray's props make.
 */
export const sendFree = async ({ editor, engine, project, values, source }: SendInput, params: ImageParams): Promise<{ batchId: string } | "stay"> => {
  if (source.kind !== "selection") throw new Error(NO_FREE_SOURCE);
  const found = freeSource(source);
  if (found.source === undefined) throw new Error(NO_FREE_SOURCE);
  if (found.error !== undefined) throw new Error(found.error);
  const batchId = mintBatchId();
  const rendered = new Map<string, RecipeRef>();
  const { composition } = source;
  const slots = await renderSlots(editor, project, composition.references, rendered);

  let listText = found.text;
  let repaired = false;
  const repairNotes: string[] = [];
  let extraCost: number | undefined;
  if (splitList(found.listText).sections.length < 2) {
    const images = slots.filter((_ref, index) => composition.references[index]!.kind === "image");
    const shape = editor.getShape(found.source.id as TLShapeId);
    const model = found.source.textResult && shape ? resultMetaOf(shape)?.model : undefined;
    const answer = await engine.call("text.complete", {
      project,
      system: repairSystemPrompt(images.length),
      prompt: repairUserTurn(found.listText),
      references: images,
      batchId,
      ...(model === undefined ? {} : { model }),
    });
    if (answer.cost !== null) extraCost = answer.cost;
    const split = splitList(answer.text);
    const sections = split.sections.length + split.truncated;
    if (sections > 1) {
      listText = answer.text;
      repaired = true;
    }
    repairNotes.push(repairNote(sections));
  }

  const stage: StagedFree = {
    project,
    batchId,
    sourceId: found.source.id,
    listText,
    repaired,
    instruction: source.instruction,
    repairNotes,
    extraCost,
    model: values.model,
    params,
    rendered,
  };
  const batch = freeBatch({ shapes: source.shapes, selected: source.selected, instruction: source.instruction, sourceId: found.source.id, listText, repaired });
  if (batch.error !== undefined) throw new Error(batch.error);
  if (batch.runs.length === 0) throw new Error(NO_SECTIONS);
  if (viewsFinalPrompt(values.props)) {
    stagedFree(editor).set(stage);
    return "stay";
  }
  return sendBatch(editor, engine, stage, batch);
};
