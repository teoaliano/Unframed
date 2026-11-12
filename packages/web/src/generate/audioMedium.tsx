import type { AudioRunParams, ResultRecipe } from "@unframed/contracts";
import {
  advancedCount,
  advancedLabel,
  AUDIO_FORMATS,
  audioDefaults,
  audioKeep,
  audioParams,
  audioReset,
  audioRoles,
  audioRunParams,
  audioStatus,
  DEFAULT_AUDIO_FORMAT,
  SEED_MAX,
  SIMILARITY,
  SPEED,
  STABILITY,
  STYLE,
  VOICE_ID,
  VOICE_NAME,
  voiceOf,
  type AudioCatalogueEntry,
  type AudioParams,
  type ModelParams,
  type RangeProp,
} from "@unframed/domain";
import { useId, useState, type ReactNode } from "react";
import type { TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Combobox, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxPopup, ComboboxSearchInput, ComboboxTrigger } from "~/components/ui/combobox";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectButton, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { TrayChip } from "./composer/PropTray.tsx";
import { VoiceDialog } from "./composer/VoiceDialog.tsx";
import { anchorOf, pageBox } from "./facts.ts";
import { planOf } from "./imageMedium.ts";
import { saveLastUsed } from "./lastUsed.ts";
import { registerMedium, type LeadChipProps, type MediumDefinition, type PropValue, type SendInput, type TrayPropChipProps, type TrayPropDefinition, type TrayProps } from "./mediumRegistry.ts";

export const AUDIO_HINT = "Bracketed directions like [whispers] or [excited] shape the delivery on Eleven v3 and v4.";

const asAudio = (params: ModelParams) => params as AudioParams;

const fixed = (value: number) => value.toFixed(2);

const chipText = (prop: RangeProp, value: number) => `${prop.label} ${fixed(value)}${prop.key === "speed" ? "×" : ""}`;

const numberOf = (value: PropValue | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const VoiceChip = ({ props, onChange, onMenuOpen }: LeadChipProps) => {
  const [open, setOpen] = useState(false);
  const voice = voiceOf(props);
  const setOpenReported = (next: boolean) => {
    setOpen(next);
    onMenuOpen("voice", next);
  };
  return (
    <>
      <TrayChip data-testid="voice-chip" onClick={() => setOpenReported(true)}>
        {voice === undefined ? <span className="text-(--generate-tray-placeholder)">Pick a voice</span> : voice.name}
      </TrayChip>
      <VoiceDialog open={open} onOpenChange={setOpenReported} current={voice?.id} onPick={(picked) => onChange({ ...props, [VOICE_ID]: picked.id, [VOICE_NAME]: picked.name })} />
    </>
  );
};

const RangeControl = ({ prop, value, onChange, labelled = true }: { readonly prop: RangeProp; readonly value: number; readonly onChange: (value: number) => void; readonly labelled?: boolean }) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {labelled && (
        <label htmlFor={id} className="text-xs font-medium text-(--generate-tray-label)">
          {prop.label}
        </label>
      )}
      <div className="flex items-center gap-2">
        {/* oxlint-disable-next-line react/forbid-elements -- the kit has no slider, so the control is the native range input */}
        <input
          id={id}
          type="range"
          aria-label={labelled ? undefined : prop.label}
          className="min-w-0 flex-1 accent-(--generate-tray-range-fill)"
          min={prop.min}
          max={prop.max}
          step={prop.step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <span className="w-10 shrink-0 text-right text-xs text-(--generate-tray-meta) tabular-nums" data-testid={`${prop.key}-value`}>
          {fixed(value)}
        </span>
      </div>
    </div>
  );
};

const deliveryProp = (prop: RangeProp): TrayPropDefinition => {
  const Chip = ({ props, onChange, open, onOpenChange }: TrayPropChipProps) => {
    const value = numberOf(props[prop.key], prop.default);
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger data-prop={prop.key} render={<TrayChip />}>
          {chipText(prop, value)}
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" sideOffset={6} padding="compact" className="w-60" aria-label={prop.label}>
          <div className="flex flex-col gap-2">
            <RangeControl prop={prop} value={value} onChange={(next) => onChange({ ...props, [prop.key]: next })} />
            <Separator />
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...props, [prop.key]: prop.default })}>
                Reset
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const { [prop.key]: _removed, ...rest } = props;
                  onChange(rest);
                  onOpenChange(false);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    );
  };
  return {
    key: prop.key,
    label: prop.label,
    inTray: (props) => props[prop.key] !== undefined,
    offered: (params) => asAudio(params).delivery.some((each) => each.key === prop.key),
    addValue: () => `${fixed(prop.default)}${prop.key === "speed" ? "×" : ""}`,
    add: (props) => ({ ...props, [prop.key]: prop.default }),
    Chip,
  };
};

const AdvancedRow = ({ label, set, onReset, children }: { readonly label: string; readonly set: boolean; readonly onReset: () => void; readonly children: ReactNode }) => (
  <div className="flex flex-col gap-1.5" data-advanced={label}>
    <div className="flex min-h-6 items-center justify-between gap-2">
      <span className="text-xs font-medium text-(--generate-tray-label)">{label}</span>
      <Button variant="ghost" size="xs" data-set={set ? "true" : undefined} onClick={onReset} aria-label={`Reset ${label}`}>
        Reset
      </Button>
    </div>
    {children}
  </div>
);

const without = (props: TrayProps, key: string): Record<string, PropValue> => {
  const { [key]: _removed, ...rest } = props;
  return rest;
};

const LanguagePicker = ({ languages, value, onChange }: { readonly languages: AudioParams["languages"]; readonly value: string | undefined; readonly onChange: (value: string) => void }) => {
  const label = (id: string) => {
    const language = languages.find((each) => each.id === id);
    return language === undefined ? id : `${language.name} (${language.id})`;
  };
  return (
    <Combobox items={languages.map((language) => language.id)} value={value ?? null} onValueChange={(next) => typeof next === "string" && onChange(next)} itemToStringLabel={label}>
      <ComboboxTrigger aria-label="Language" render={<SelectButton size="sm" />}>
        {value === undefined ? <span className="text-(--generate-tray-placeholder)">Model default</span> : label(value)}
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Languages">
        <ComboboxSearchInput aria-label="Search languages" placeholder="Search languages" />
        <ComboboxEmpty>No language matches.</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id}>
              {label(id)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
};

const AdvancedChip = ({ props, params, onChange, open, onOpenChange }: TrayPropChipProps) => {
  const audio = asAudio(params);
  const count = advancedCount(props);
  const offered = new Set(audio.advanced);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger data-prop="advanced" render={<TrayChip />}>
        {count > 0 ? `Advanced · ${count}` : "Advanced"}
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" sideOffset={6} padding="compact" className="w-70" aria-label="Advanced">
        <div className="flex flex-col gap-3">
          <AdvancedRow label={advancedLabel("similarity_boost")} set={props.similarity_boost !== undefined} onReset={() => onChange(without(props, "similarity_boost"))}>
            <RangeControl prop={SIMILARITY} labelled={false} value={numberOf(props.similarity_boost, SIMILARITY.default)} onChange={(value) => onChange({ ...props, similarity_boost: value })} />
          </AdvancedRow>
          {offered.has("use_speaker_boost") && (
            <AdvancedRow label={advancedLabel("use_speaker_boost")} set={props.use_speaker_boost !== undefined} onReset={() => onChange(without(props, "use_speaker_boost"))}>
              <Switch aria-label="Speaker boost" checked={props.use_speaker_boost !== false} onCheckedChange={(checked: boolean) => onChange({ ...props, use_speaker_boost: checked })} />
            </AdvancedRow>
          )}
          <AdvancedRow label={advancedLabel("output_format")} set={props.output_format !== undefined} onReset={() => onChange(without(props, "output_format"))}>
            <Select value={typeof props.output_format === "string" ? props.output_format : DEFAULT_AUDIO_FORMAT} onValueChange={(value) => typeof value === "string" && onChange({ ...props, output_format: value })}>
              <SelectTrigger aria-label="Format" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {AUDIO_FORMATS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {format}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </AdvancedRow>
          <AdvancedRow label={advancedLabel("seed")} set={props.seed !== undefined} onReset={() => onChange(without(props, "seed"))}>
            <NumberField
              key={String(props.seed ?? "")}
              size="sm"
              min={0}
              max={SEED_MAX}
              step={1}
              {...(typeof props.seed === "number" ? { defaultValue: props.seed } : {})}
              onValueCommitted={(typed) => onChange(typed === null || !Number.isInteger(typed) ? without(props, "seed") : { ...props, seed: typed })}
            >
              <NumberFieldGroup>
                <NumberFieldInput aria-label="Seed" placeholder="Random" />
              </NumberFieldGroup>
            </NumberField>
          </AdvancedRow>
          {offered.has("language_code") && (
            <AdvancedRow label={advancedLabel("language_code")} set={props.language_code !== undefined} onReset={() => onChange(without(props, "language_code"))}>
              <LanguagePicker languages={audio.languages} value={typeof props.language_code === "string" ? props.language_code : undefined} onChange={(value) => onChange({ ...props, language_code: value })} />
            </AdvancedRow>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};

const advancedProp: TrayPropDefinition = {
  key: "advanced",
  label: "Advanced",
  inTray: () => true,
  addValue: () => "",
  add: (props) => ({ ...props }),
  Chip: AdvancedChip,
};

const send = async ({ editor, engine, project, values, source, remember }: SendInput) => {
  const plan = planOf(source);
  const voice = voiceOf(values.props);
  if (voice === undefined) throw new Error("Pick a voice for this line.");
  const common = {
    project,
    ...(values.model === undefined ? {} : { model: values.model }),
    voice,
    params: audioRunParams(values.props) as AudioRunParams,
    selectionPrompt: plan.selectionPrompt,
    instruction: plan.instruction,
    prompt: plan.prompt,
  };
  const request =
    source.kind === "selection"
      ? {
          ...common,
          sources: [...source.composition.sources],
          anchor: anchorOf(editor, source),
          ...(source.answersFor === undefined ? {} : { of: { shapeId: source.answersFor, action: "recipe" as const } }),
        }
      : {
          ...common,
          sources: [...source.recipe.recipe.sources],
          anchor: pageBox(editor, source.recipe.shapeId as TLShapeId) ?? { x: 0, y: 0, w: 0, h: 0 },
          of: { shapeId: source.recipe.shapeId, action: "recipe" as const },
        };
  const started = await engine.call("run.audio", request);
  if (remember !== false) {
    const { [VOICE_ID]: _id, [VOICE_NAME]: _name, ...props } = values.props;
    void saveLastUsed(engine, "audio", { ...(values.picked && values.model !== undefined ? { model: values.model } : {}), props, voice });
  }
  return { batchId: started.batchId };
};

const fromRecipe = (recipe: ResultRecipe): TrayProps => ({ ...recipe.params });

export const audioMedium: MediumDefinition = {
  medium: "audio",
  label: "audio",
  catalogue: "audio",
  dialogTitle: "Audio models",
  browseUrl: "https://elevenlabs.io/docs/overview/models",
  browseLabel: "Browse on ElevenLabs",
  modelColumns: "languages",
  hint: AUDIO_HINT,
  params: (entry) => audioParams(entry as AudioCatalogueEntry | undefined),
  defaults: (params) => audioDefaults(asAudio(params)),
  reset: (props, params) => audioReset(props, asAudio(params)),
  keep: (props, params) => audioKeep(props, asAudio(params)),
  pricing: async () => undefined,
  estimate: () => undefined,
  status: ({ source, hasElevenLabsKey, props = {}, entry, model }) => {
    const plan = planOf(source);
    const media = source.kind === "selection" ? source.composition.references.map((slot) => ({ kind: slot.kind })) : [];
    const { warnings, blockers } = audioStatus({
      text: plan.prompt,
      error: plan.error,
      media,
      voice: voiceOf(props),
      model,
      params: audioParams(entry as AudioCatalogueEntry | undefined, model),
      hasKey: hasElevenLabsKey ?? true,
    });
    return { warnings, blockers, needsKey: false };
  },
  sendLabel: () => "Generate",
  roles: ({ composition }) => audioRoles(composition),
  send,
  fromRecipe,
  trayProps: [deliveryProp(STABILITY), deliveryProp(STYLE), deliveryProp(SPEED), advancedProp],
  Lead: VoiceChip,
};

registerMedium(audioMedium);

