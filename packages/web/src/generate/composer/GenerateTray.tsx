import { UnframedError, type Medium } from "@unframed/contracts";
import { composeSelection, resolveReferences, selectionHint } from "@unframed/domain";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useEditor, useValue } from "tldraw";
import { useEngine, useSettings } from "../../context.ts";
import { useCatalogue, usePricing } from "../catalogue.ts";
import { canvasShapes, resultShapes, toolbarShape } from "../facts.ts";
import { loadLastUsed, type LastUsed } from "../lastUsed.ts";
import { mediumDefinition, registeredMedia, type PropValue, type RunSource, type TrayValues } from "../mediumRegistry.ts";
import { composerState, setMedium, type RecipeMode } from "../state.ts";
import { InstructionEditor } from "./InstructionEditor.tsx";
import { ModelDialog } from "./ModelDialog.tsx";
import { PropTray } from "./PropTray.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const INSTRUCTION_PLACEHOLDER = "What should this make?";

/** How many sources a recipe records: its reference slots plus its prompt parts. */
const recipeSources = (recipe: RecipeMode): number =>
  recipe.recipe.references.length + recipe.recipe.selectionPrompt.split(/\n\n+/).filter((part) => part.trim() !== "").length;

export interface TrayHandle {
  /** Sends, unless a send is already being acknowledged or something stops it. */
  send(): void;
}

export interface GenerateTrayProps {
  readonly project: string;
  readonly recipe: RecipeMode | undefined;
  /** Called once the engine has acknowledged the run: the composer collapses back to the bar. */
  readonly onSent: () => void;
  readonly onMenuOpen: (key: string, open: boolean) => void;
  readonly handle: Ref<TrayHandle>;
}

/**
 * The Generate tray: the medium switch and source count above the box, the instruction,
 * the estimate and send in it, status lines under it, and the model and props below.
 */
export const GenerateTray = ({ project, recipe, onSent, onMenuOpen, handle }: GenerateTrayProps) => {
  const editor = useEditor();
  const engine = useEngine();
  const settings = useSettings();
  const medium = useValue("composer medium", () => composerState(editor).get().medium, [editor]);
  const definition = mediumDefinition(medium) ?? registeredMedia()[0]!;
  const catalogue = useCatalogue(engine, definition.catalogue);
  const [stored, setStored] = useState<{ readonly medium: Medium; readonly value: LastUsed | null }>();
  // Another medium's values are never this one's, even for the render before the switch lands.
  const lastUsed = stored?.medium === medium ? stored.value : undefined;
  const [valuesByMedium, setValuesByMedium] = useState<Partial<Record<Medium, TrayValues>>>({});
  const [instruction, setInstruction] = useState(recipe?.recipe.instruction ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let live = true;
    void loadLastUsed(engine, medium).then((value) => {
      if (live) setStored({ medium, value: value ?? null });
    });
    return () => {
      live = false;
    };
  }, [engine, medium]);

  const entryOf = useCallback((model: string | undefined) => catalogue?.models.find((entry) => entry.id === model), [catalogue]);

  // The tray opens on the recipe's values in recipe mode, else the last-used values, else the defaults.
  useEffect(() => {
    if (valuesByMedium[medium] || !catalogue || lastUsed === undefined) return;
    let values: TrayValues;
    if (recipe && recipe.recipe.medium === medium) {
      // The recorded model is not a pick: only the model dialog makes one.
      values = { model: recipe.recipe.model, picked: false, props: definition.keep(definition.fromRecipe(recipe.recipe), definition.params(entryOf(recipe.recipe.model))) };
    } else {
      const stored = lastUsed?.model !== undefined && catalogue.models.some((entry) => entry.id === lastUsed.model) ? lastUsed.model : undefined;
      const model = stored ?? catalogue.default;
      const params = definition.params(entryOf(model));
      values = { model, picked: stored !== undefined, props: lastUsed ? definition.keep(lastUsed.props, params) : definition.defaults(params) };
    }
    setValuesByMedium((current) => ({ ...current, [medium]: values }));
  }, [valuesByMedium, medium, catalogue, lastUsed, recipe, definition, entryOf]);

  const values = valuesByMedium[medium];
  const params = useMemo(() => definition.params(entryOf(values?.model)), [definition, entryOf, values?.model]);
  const pricing = usePricing(engine, definition, values?.model);

  const composition = useValue(
    "composition",
    () => composeSelection({ shapes: canvasShapes(editor), selected: editor.getSelectedShapeIds(), instruction, medium, referenceCap: params.referenceCap }),
    [editor, instruction, medium, params.referenceCap],
  );
  const hint = useValue(
    "source count",
    () => selectionHint(editor.getSelectedShapes().map((shape) => toolbarShape(editor, shape)), resultShapes(editor)),
    [editor],
  );

  const resolved = useValue("recipe instruction", () => (recipe ? resolveReferences(instruction, canvasShapes(editor)) : undefined), [editor, recipe, instruction]);
  const shapes = useValue("canvas shapes", () => canvasShapes(editor), [editor]);
  const source: RunSource = recipe
    ? { kind: "recipe", recipe, instruction: resolved?.ok ? resolved.text.trim() : "", error: resolved?.ok === false ? resolved.error : undefined }
    : { kind: "selection", composition, selected: editor.getSelectedShapeIds(), shapes, instruction };
  const status = definition.status({ source, hasKey: settings?.hasKey ?? true, props: values?.props });
  const estimate = values ? definition.estimate({ pricing, props: values.props, source }) : undefined;
  const blocked = status.blockers.length > 0 || values === undefined;

  const onMentionMenu = useCallback((open: boolean) => onMenuOpen("mention", open), [onMenuOpen]);
  const onTrayMenu = useCallback((open: boolean) => onMenuOpen("tray", open), [onMenuOpen]);

  const setValues = (next: TrayValues) => setValuesByMedium((current) => ({ ...current, [medium]: next }));

  const box = useRef<{ readonly element: () => HTMLElement | null }>(null);
  const inFlight = useRef(false);
  const send = async () => {
    if (inFlight.current || blocked || !values) return;
    inFlight.current = true;
    setSending(true);
    setFailure(undefined);
    try {
      if ((await definition.send({ editor, engine, project, values, source })) !== "stay") onSent();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  useImperativeHandle(handle, () => ({ send: () => void send() }));

  const media = registeredMedia();
  return (
    <div className="unframed-composer-generate">
      <div className="unframed-composer-top">
        <div role="radiogroup" aria-label="Medium" className="unframed-segmented">
          {media.map((each) => (
            <button
              key={each.medium}
              type="button"
              role="radio"
              aria-checked={each.medium === medium}
              data-on={each.medium === medium ? "" : undefined}
              onClick={() => setMedium(editor, each.medium)}
            >
              {each.label}
            </button>
          ))}
        </div>
        <span className="unframed-composer-count" data-testid="source-count">
          {recipe ? `recipe · ${recipeSources(recipe)} sources` : hint}
        </span>
      </div>
      <div className="unframed-composer-box">
        <InstructionEditor
          initial={instruction}
          placeholder={INSTRUCTION_PLACEHOLDER}
          onChange={setInstruction}
          onMenuOpen={onMentionMenu}
          handle={box}
        />
        <div className="unframed-composer-send">
          {estimate !== undefined && (
            <span className="unframed-composer-estimate" data-testid="estimate">
              {estimate}
            </span>
          )}
          <button
            type="button"
            className="unframed-composer-go"
            aria-busy={sending || undefined}
            data-sending={sending ? "true" : undefined}
            disabled={blocked || sending}
            onClick={() => void send()}
          >
            {sending ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <ArrowUp size={14} aria-hidden />}
            {definition.sendLabel(values ?? { model: undefined, picked: false, props: {} })}
          </button>
        </div>
      </div>
      {(status.warnings.length > 0 || status.blockers.length > 0 || failure !== undefined) && (
        <div className="unframed-composer-status" data-testid="composer-status">
          {status.warnings.map((line) => (
            <p key={line} role="status" data-kind="warning">
              {line}
            </p>
          ))}
          {status.blockers.map((line) => (
            <p key={line} role="status" data-kind="blocked">
              {line}
            </p>
          ))}
          {failure !== undefined && (
            <p role="alert" data-kind="error">
              {failure}
            </p>
          )}
        </div>
      )}
      <PropTray
        model={values?.model}
        catalogueReady={catalogue !== undefined && catalogue.models.length > 0 && values !== undefined}
        params={params}
        extra={definition.trayProps}
        props={values?.props ?? {}}
        onModelClick={() => {
          setDialogOpen(true);
          onMenuOpen("dialog", true);
        }}
        onChange={(props: Record<string, PropValue>) => values && setValues({ ...values, props })}
        onMenuOpen={onTrayMenu}
      />
      <ModelDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          onMenuOpen("dialog", open);
        }}
        title={definition.dialogTitle}
        browseUrl={definition.browseUrl}
        models={catalogue?.models ?? []}
        current={values?.model}
        finalFocus={() => box.current?.element() ?? null}
        onPick={(model) => {
          if (!values) return;
          const props = model === values.model ? values.props : definition.reset(values.props, definition.params(entryOf(model)));
          setValues({ model, picked: true, props });
        }}
      />
      {definition.Overlay && <definition.Overlay project={project} onSent={onSent} onMenuOpen={onMenuOpen} />}
    </div>
  );
};
