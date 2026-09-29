/**
 * Inserting a preset (spec 06): its files copied into this project, its content migrated
 * to the canvas's schema, fresh `@id`s with its own references following them, its group
 * centred on the view, then put on the page as one undo step with the group selected.
 * Nothing that reaches the room holds a `preset-file:` pointer, which the room refuses.
 */
import {
  instantiate,
  placeAt,
  PRESET_NOT_ONE_GROUP_MESSAGE,
  presetFiles,
  presetWithTextModel,
  readRef,
  resolvePresetFiles,
  type ContentAsset,
  type ContentShape,
  type Preset,
  type PresetContent,
} from "@unframed/domain";
import { AssetRecordType, type Editor, type TLContent, type TLRecord } from "tldraw";
import { RefMinter } from "../canvas/refs.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";

/** The content with tldraw's migrations applied, written in the canvas's own schema. */
const migrated = (editor: Editor, content: PresetContent): PresetContent => {
  const records = [...content.shapes, ...content.assets, ...((content.bindings ?? []) as ReadonlyArray<{ id: string }>)] as unknown as TLRecord[];
  const result = editor.store.schema.migrateStoreSnapshot({
    store: Object.fromEntries(records.map((record) => [record.id, record])) as never,
    schema: content.schema as never,
  });
  if (result.type === "error") throw new Error("This preset was saved by a version of the app that cannot be read here.");
  const all = Object.values(result.value) as Array<{ typeName: string }>;
  const byId = (ids: ReadonlyArray<{ id: string }>) => ids.map((record) => (result.value as Record<string, unknown>)[record.id]).filter((record) => record !== undefined);
  return {
    schema: editor.store.schema.serialize(),
    shapes: byId(content.shapes) as ContentShape[],
    assets: byId(content.assets) as ContentAsset[],
    bindings: all.filter((record) => record.typeName === "binding"),
    rootShapeIds: content.rootShapeIds,
  };
};

export const missingFilesMessage = (count: number, name: string) => `${count} file(s) in “${name}” are no longer on disk, so their shapes arrived empty.`;

export const insertPreset = async (input: {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly preset: Preset;
  /** The app's default text model now: a system preset's recipe takes it. */
  readonly textModel: string | undefined;
}): Promise<void> => {
  const { editor, engine, project } = input;
  const preset = input.preset.source === "system" && input.textModel ? presetWithTextModel(input.preset, input.textModel) : input.preset;
  const files = presetFiles(preset.content);
  const copied = files.length === 0 ? [] : await engine.call("library.copyFiles", { project, files });
  const resolved = resolvePresetFiles(preset.content, copied, () => AssetRecordType.createId());

  const content = migrated(editor, resolved.content);
  const minter = new RefMinter(editor);
  const taken = editor.getCurrentPageShapes().flatMap((shape) => readRef(shape) ?? []);
  const made = instantiate(content, taken, () => minter.mint());
  const group = made.content.shapes.find((shape) => shape.id === made.rootId);
  if (!group) throw new Error(PRESET_NOT_ONE_GROUP_MESSAGE);
  const at = placeAt({ x: group.x, y: group.y, w: Number(group.props.w), h: Number(group.props.h) }, editor.getViewportPageBounds().center);
  const placed = { ...made.content, shapes: made.content.shapes.map((shape) => (shape.id === made.rootId ? { ...shape, ...at } : shape)) };

  editor.markHistoryStoppingPoint("add preset");
  editor.putContentOntoCurrentPage(placed as unknown as TLContent, { select: true, preservePosition: true });
  if (resolved.missing > 0) showError(missingFilesMessage(resolved.missing, preset.name));
};
