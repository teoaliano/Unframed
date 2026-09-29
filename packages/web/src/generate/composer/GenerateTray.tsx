import { UnframedError, type Medium } from "@unframed/contracts";
import { composeSelection, readRef, recipeEquals, recipeFromTray, resolveReferences, selectionHint } from "@unframed/domain";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { appliedRecipe, groupRecipeOf, setGroupRecipe } from "../../canvas/groupRecipes.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useEngine, useSettings } from "../../context.ts";
import { IMPORTED_RECIPE_NOTE, liveSource } from "../approximate.ts";
import { useCatalogue, usePricing } from "../catalogue.ts";
import { canvasShapes, resultShapes, toolbarShape } from "../facts.ts";
import { loadLastUsed, type LastUsed } from "../lastUsed.ts";
import { mediumDefinition, registeredMedia, type PropValue, type RunSource, type TrayValues } from "../mediumRegistry.ts";
import { recipeProps } from "../recipeRuns.ts";
import { composerState, setMedium, type RecipeMode } from "../state.ts";
import { trayView } from "../trayView.ts";
import { InstructionEditor } from "./InstructionEditor.tsx";
import { ModelDialog } from "./ModelDialog.tsx";
import { PropTray } from "./PropTray.tsx";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const INSTRUCTION_PLACEHOLDER = "What should this make?";

/** How many sources a recipe records: its reference slots plus its prompt parts. */
const recipeSources = (recipe: RecipeMode): number =>
  recipe.recipe.references.length + recipe.recipe.selectionPrompt.split(/\n\n+/).filter((part) => part.trim() !== "").length;

const quietButton =
  "h-6 cursor-pointer rounded-inner border-0 bg-transparent px-1.5 text-[12.5px] text-secondary hover:bg-hover hover:text-primary disabled:cursor-default disabled:opacity-50";
const plainButton = "h-6 cursor-pointer rounded-inner border border-line bg-transparent px-2 text-[12.5px] text-primary hover:bg-hover";

/**
 * The line under the tray while the selection is exactly one group: Save as recipe for a
 * plain group; for a recipe group, whether the tray matches its recipe, Update recipe when
 * it does not, and Clear recipe. Only these buttons write to the group.
 */
const RecipeLine = ({
  groupId,
  medium,
  values,
  onDone,
}: {
  readonly groupId: TLShapeId;
  readonly medium: Medium;
  readonly values: TrayValues | undefined;
  /** The button pressed goes away with the change, so the keyboard goes back to the box. */
  readonly onDone: () => void;
}) => {
  const editor = useEditor();
  const name = useValue("group name", () => readRef(editor.getShape(groupId) ?? {}) ?? "", [editor, groupId]);
  const standing = useValue("group recipe", () => groupRecipeOf(editor.getShape(groupId)), [editor, groupId]);
  const current = values?.model === undefined ? undefined : recipeFromTray({ medium, model: values.model, props: values.props });
  const save = () => {
    if (current) setGroupRecipe(editor, groupId, current);
    onDone();
  };
  const clear = () => {
    setGroupRecipe(editor, groupId, undefined);
    onDone();
  };
  if (!standing) {
    return (
      <div className="unframed-composer-recipe" data-testid="recipe-line">
        <Tip label={`Keep these settings on @${name}. Its Generate uses them.`} side="top">
          <button type="button" className={quietButton} disabled={!current} onClick={save}>
            Save as recipe
          </button>
        </Tip>
      </div>
    );
  }
  return (
    <div className="unframed-composer-recipe" data-testid="recipe-line">
      {current && recipeEquals(current, standing) ? (
        <span className="text-[12.5px] text-secondary">Recipe of @{name}</span>
      ) : (
        <button type="button" className={plainButton} disabled={!current} onClick={save}>
          Update recipe
        </button>
      )}
      <button type="button" className={quietButton} onClick={clear}>
        Clear recipe
      </button>
    </div>
  );
};

export interface TrayHandle {
  /** Sends, unless a send is already being acknowledged or something stops it. */
  send(): void;
}

export interface GenerateTrayProps {
  readonly project: string;
  readonly recipe: RecipeMode | undefined;
  /** Called once the engine has acknowledged the run: the composer collapses back to the bar. */
  readonly onSent: () => void;
  /** A menu or dialog opened or closed; `close` lets the shell close it on Esc. */
  readonly onMenuOpen: (key: string, open: boolean, close?: () => void) => void;
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

  // The one recipe group the selection held when the composer opened (spec 06): its recipe is the tray's start.
  const [standing] = useState(() => (recipe ? undefined : appliedRecipe(editor)?.recipe));
  useEffect(() => {
    if (standing && composerState(editor).get().medium !== standing.medium) setMedium(editor, standing.medium);
  }, [editor, standing]);

  // The tray opens on the recipe's values in recipe mode or on a recipe group, else the last-used values, else the defaults.
  useEffect(() => {
    if (valuesByMedium[medium] || !catalogue || lastUsed === undefined) return;
    let values: TrayValues;
    if (recipe && recipe.recipe.medium === medium) {
      // The recorded model is not a pick: only the model dialog makes one.
      const recorded = definition.fromRecipe(recipe.recipe);
      values = { model: recipe.recipe.model, picked: false, props: definition.keep(recorded, definition.params(entryOf(recipe.recipe.model), recorded)) };
    } else if (standing && standing.medium === medium) {
      const model = standing.model === "" ? catalogue.default : standing.model;
      values = { model, picked: false, props: recipeProps(definition, standing, entryOf(model)) };
    } else {
      const stored = lastUsed?.model !== undefined && catalogue.models.some((entry) => entry.id === lastUsed.model) ? lastUsed.model : undefined;
      const model = stored ?? catalogue.default;
      const params = definition.params(entryOf(model), lastUsed?.props);
      values = { model, picked: stored !== undefined, props: lastUsed ? definition.keep(lastUsed.props, params) : definition.defaults(params) };
    }
    setValuesByMedium((current) => ({ ...current, [medium]: values }));
  }, [valuesByMedium, medium, catalogue, lastUsed, recipe, standing, definition, entryOf]);

  const values = valuesByMedium[medium];
  const entry = entryOf(values?.model);
  const params = useMemo(() => definition.params(entry, values?.props), [definition, entry, values?.props]);
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

  const onlyGroup = useValue(
    "only group",
    () => {
      const only = editor.getOnlySelectedShape();
      return only?.type === "frame" ? only.id : undefined;
    },
    [editor],
  );

  const resolved = useValue("recipe instruction", () => (recipe ? resolveReferences(instruction, canvasShapes(editor)) : undefined), [editor, recipe, instruction]);
  const shapes = useValue("canvas shapes", () => canvasShapes(editor), [editor]);
  // An imported result (spec 11) sends from its sources as they are now.
  const live = useValue("imported recipe sources", () => (recipe?.recipe.approximate ? liveSource(editor, recipe.shapeId, recipe.recipe, instruction) : undefined), [editor, recipe, instruction]);
  const source: RunSource =
    live ??
    (recipe
      ? { kind: "recipe", recipe, instruction: resolved?.ok ? resolved.text.trim() : "", error: resolved?.ok === false ? resolved.error : undefined }
      : { kind: "selection", composition, selected: editor.getSelectedShapeIds(), shapes, instruction });
  const status = definition.status({ source, hasKey: settings?.hasKey ?? true, props: values?.props, entry });
  const estimate = values ? definition.estimate({ pricing, props: values.props, source, entry }) : undefined;
  const blocked = status.blockers.length > 0 || values === undefined;

  const onMentionMenu = useCallback((open: boolean) => onMenuOpen("mention", open), [onMenuOpen]);
  const onTrayMenu = useCallback((open: boolean, close: () => void) => onMenuOpen("tray", open, close), [onMenuOpen]);

  const setValues = (next: TrayValues) => setValuesByMedium((current) => ({ ...current, [medium]: next }));

  // A stored value the model cannot honour clears itself once the catalogue is known.
  useEffect(() => {
    if (!values || !definition.heal) return;
    const healed = definition.heal({ props: values.props, entry, loaded: catalogue !== undefined });
    if (healed) setValuesByMedium((current) => ({ ...current, [medium]: { ...values, props: healed } }));
  }, [definition, values, entry, catalogue, medium]);

  // What the canvas draws from the tray (the role badges) reads its values here.
  useEffect(() => {
    trayView(editor).set({ medium, props: values?.props ?? {}, entry });
  }, [editor, medium, values?.props, entry]);
  useEffect(
    () => () => {
      trayView(editor).set(undefined);
    },
    [editor],
  );

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
        <span className="unframed-composer-count" data-testid="source-count" data-chip={!recipe && hint.startsWith("@") ? "group" : undefined}>
          {recipe ? `recipe · ${live ? live.selected.length : recipeSources(recipe)} sources` : hint}
        </span>
      </div>
      {live && recipe?.recipe.sentPrompt !== undefined && (
        <div className="unframed-composer-sent" data-testid="recipe-sent">
          <p>{IMPORTED_RECIPE_NOTE}</p>
          <p>{recipe.recipe.sentPrompt}</p>
        </div>
      )}
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
            {sending && definition.sendingLabel !== undefined ? definition.sendingLabel : definition.sendLabel(values ?? { model: undefined, picked: false, props: {} })}
          </button>
        </div>
      </div>
      {definition.Status && values ? (
        <definition.Status status={status} failure={failure} values={values} source={source} entry={entry} setProps={(props) => setValues({ ...values, props })} />
      ) : (status.warnings.length > 0 || status.blockers.length > 0 || failure !== undefined) && (
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
        addable={definition.addable}
        onModelClick={() => {
          setDialogOpen(true);
          onMenuOpen("dialog", true);
        }}
        onChange={(props: Record<string, PropValue>) => values && setValues({ ...values, props })}
        onMenuOpen={onTrayMenu}
      />
      {onlyGroup !== undefined && !recipe && <RecipeLine groupId={onlyGroup} medium={medium} values={values} onDone={() => box.current?.element()?.focus()} />}
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
