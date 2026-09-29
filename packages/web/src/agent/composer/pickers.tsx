import type { AgentProvider, ModelSelection, ProviderModel, ProviderStatuses } from "@unframed/contracts";
import { contextMeter, type Chat, type ContextUsage, type InteractionMode, type RuntimeMode, type Traits } from "@unframed/domain";
import { Check, ChevronDown, Ellipsis, Lock, LockOpen, Minimize2, PencilLine, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import claudeLogo from "../../../../../assets/brand/provider-logos/claude.svg?url";
import codexLogo from "../../../../../assets/brand/provider-logos/codex.svg?url";
import { Tip } from "../../chrome/ui.tsx";
import { Chevron, Disclosure } from "../transcript/WorkLog.tsx";
import { effectiveModel, modelsOf, PROVIDERS, providerName } from "../providers.ts";
import { record } from "../record.ts";

const LOGOS: Record<AgentProvider, string> = { claude: claudeLogo, codex: codexLogo };

export const ProviderLogo = ({ provider }: { readonly provider: AgentProvider }) => (
  <span
    role="img"
    aria-label={providerName(provider)}
    data-logo={provider}
    className="inline-block size-3.5 shrink-0 bg-current"
    style={{ mask: `url("${LOGOS[provider]}") center / contain no-repeat`, WebkitMask: `url("${LOGOS[provider]}") center / contain no-repeat` }}
  />
);

/** t3code's picker row: a list row that highlights under the pointer and the keys, the chosen one tinted. */
const PICKER_ROW =
  "flex min-h-7 w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-left text-sm text-foreground outline-none data-chosen:bg-foreground/[0.08] data-highlighted:bg-accent data-highlighted:text-accent-foreground";


// ---------------------------------------------------------------------------------------
// The model picker.

export interface ModelPickerProps {
  readonly statuses: ProviderStatuses | undefined;
  readonly selection: ModelSelection;
  /** The chat exists: it stays on the provider it started on. */
  readonly providerLocked: boolean;
  /** A turn is running: the model waits for it to finish. */
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (provider: AgentProvider, model: ProviderModel) => void;
}

/**
 * The model picker (t3code's): Claude and Codex tabs with their logos, a search, the
 * current models and a collapsible Legacy section. A tab whose provider is not ready
 * shows its status instead.
 */
export const ModelPicker = ({ statuses, selection, providerLocked, disabled, open, onOpenChange, onPick }: ModelPickerProps) => {
  const current = effectiveModel(statuses, selection.provider, selection.model);
  const [tab, setTab] = useState<AgentProvider>(selection.provider);
  const [query, setQuery] = useState("");
  const [legacyOpen, setLegacyOpen] = useState(current?.legacy === true);
  const [highlight, setHighlight] = useState(0);
  useEffect(() => {
    if (!open) return;
    setTab(selection.provider);
    setQuery("");
    setHighlight(0);
    setLegacyOpen(effectiveModel(statuses, selection.provider, selection.model)?.legacy === true);
  }, [open, selection.provider, selection.model, statuses]);

  const status = statuses?.[tab];
  const needle = query.trim().toLowerCase();
  const all = modelsOf(statuses, tab).filter((model) => needle === "" || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle));
  const currentRows = all.filter((model) => !model.legacy);
  const legacyRows = all.filter((model) => model.legacy);
  const visible = [...currentRows, ...(legacyOpen || needle !== "" ? legacyRows : [])];
  const pick = (model: ProviderModel) => {
    onPick(tab, model);
    onOpenChange(false);
  };

  const row = (model: ProviderModel) => {
    const index = visible.indexOf(model);
    const chosen = tab === selection.provider && current?.id === model.id;
    return (
      <div
        key={model.id}
        role="option"
        aria-selected={index === highlight}
        data-highlighted={index === highlight ? "" : undefined}
        data-chosen={chosen ? "" : undefined}
        className={PICKER_ROW}
        onMouseEnter={() => setHighlight(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(model)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium leading-snug" data-testid="model-name">
            {model.name}
          </span>
          {model.description !== "" && <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">{model.description}</span>}
        </span>
        {chosen && <Check aria-label="Current model" className="size-3.5 shrink-0" />}
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverTrigger render={<Button variant="ghost-muted" size="xs" className="min-w-0" />} aria-label="Model" data-testid="model-picker" disabled={disabled}>
        <ProviderLogo provider={selection.provider} />
        <span className="min-w-0 truncate">{current?.name ?? (selection.model === "" ? providerName(selection.provider) : selection.model)}</span>
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" sideOffset={6} padding="compact" className="w-[300px]" aria-label="Models">
        <div role="tablist" aria-label="Providers" className="mb-2 flex gap-1">
          {PROVIDERS.map((provider) => {
            const locked = providerLocked && provider !== selection.provider;
            const button = (
              <Button
                key={provider}
                variant="ghost-muted"
                size="xs"
                role="tab"
                aria-selected={tab === provider}
                aria-disabled={locked || undefined}
                data-pressed={tab === provider ? "" : undefined}
                onClick={() => {
                  if (locked) return;
                  setTab(provider);
                  setHighlight(0);
                }}
              >
                <ProviderLogo provider={provider} />
                {providerName(provider)}
              </Button>
            );
            return locked ? (
              <Tip key={provider} label={`A chat stays on the provider it started on. Start a new chat to use ${providerName(provider)}.`} side="top">
                {button}
              </Tip>
            ) : (
              button
            );
          })}
        </div>
        {status?.status !== "ready" ? (
          <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">{status?.message ?? "checking…"}</p>
        ) : (
          <>
            <Input
              size="compact"
              className="mb-1"
              placeholder="Search models..."
              aria-label="Search models"
              value={query}
              autoFocus
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && visible.length > 0) {
                  event.preventDefault();
                  setHighlight((highlight + 1) % visible.length);
                } else if (event.key === "ArrowUp" && visible.length > 0) {
                  event.preventDefault();
                  setHighlight((highlight - 1 + visible.length) % visible.length);
                } else if (event.key === "Enter" && visible[highlight]) {
                  event.preventDefault();
                  pick(visible[highlight]!);
                }
              }}
            />
            <div role="listbox" aria-label={`${providerName(tab)} models`} className="flex max-h-72 flex-col gap-px overflow-y-auto">
              {currentRows.map(row)}
              {legacyRows.length > 0 && needle === "" && (
                <Disclosure open={legacyOpen} onToggle={() => setLegacyOpen(!legacyOpen)} className={PICKER_ROW}>
                  <Chevron open={legacyOpen} />
                  <span className="text-xs font-medium">Legacy models</span>
                  <span className="ml-auto text-xs text-muted-foreground">{`${legacyRows.length} models`}</span>
                </Disclosure>
              )}
              {(legacyOpen || needle !== "") && legacyRows.map(row)}
              {all.length === 0 && <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">No models found</p>}
            </div>
          </>
        )}
      </PopoverPopup>
    </Popover>
  );
};

// ---------------------------------------------------------------------------------------
// The traits picker.

const CLAUDE_EFFORTS: Record<string, { label: string; hint: string }> = {
  low: { label: "Low", hint: "Fastest; little reasoning" },
  medium: { label: "Medium", hint: "Balanced" },
  high: { label: "High", hint: "More reasoning before acting" },
  xhigh: { label: "Extra high", hint: "Long reasoning; slower" },
  max: { label: "Max", hint: "Everything the model has" },
};

export const effortLabel = (effort: string): string => CLAUDE_EFFORTS[effort]?.label ?? effort.charAt(0).toUpperCase() + effort.slice(1);

/** The traits a model declares, and only those: a change of model drops the rest. */
export const declaredTraits = (model: ProviderModel | undefined, traits: Traits): Traits => ({
  ...(traits.effort !== undefined && model?.efforts.includes(traits.effort) ? { effort: traits.effort } : {}),
  ...(traits.thinking !== undefined && model?.thinking === true ? { thinking: traits.thinking } : {}),
  ...(traits.fastMode !== undefined && model?.fastMode === true ? { fastMode: traits.fastMode } : {}),
});

/** A choice in the traits popover: a kit ghost Button in the radio role, pressed while chosen, with its hint and the default marked. */
const RadioRow = ({ checked, label, hint, badge, onSelect }: { readonly checked: boolean; readonly label: string; readonly hint?: string; readonly badge?: string; readonly onSelect: () => void }) => (
  <Button variant="ghost" size="sm" role="radio" aria-checked={checked} data-pressed={checked ? "" : undefined} className="w-full justify-start" onClick={onSelect}>
    <span className="flex size-3.5 shrink-0 items-center justify-center">{checked && <Check aria-hidden className="size-3.5" />}</span>
    <span className="shrink-0">{label}</span>
    {hint !== undefined && <span className="min-w-0 flex-1 truncate text-start text-xs text-muted-foreground">{hint}</span>}
    {badge !== undefined && (
      <Badge variant="outline" size="sm" className="ms-auto">
        {badge}
      </Badge>
    )}
  </Button>
);

const GROUP_LABEL = "px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground";

/**
 * The traits picker: radio groups for the traits the chosen model declares (its effort
 * levels, thinking, fast mode), the model's default marked. Hidden when it declares none.
 */
export const TraitsPicker = ({ provider, model, traits, disabled, onChange }: { readonly provider: AgentProvider; readonly model: ProviderModel | undefined; readonly traits: Traits; readonly disabled: boolean; readonly onChange: (traits: Traits) => void }) => {
  if (!model || (model.efforts.length === 0 && model.thinking !== true && model.fastMode !== true)) return null;
  const effort = traits.effort ?? model.defaultEffort;
  const labels = [effort !== undefined ? effortLabel(effort) : undefined, traits.thinking === true ? "Thinking" : undefined].filter((label): label is string => label !== undefined);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost-muted" size="xs" className="min-w-0" />} aria-label="Traits" data-testid="traits-picker" disabled={disabled}>
        <span className="min-w-0 truncate">{labels.length > 0 ? labels.join(" · ") : "Default"}</span>
        {traits.fastMode === true && <Zap aria-label="Fast mode" />}
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" sideOffset={6} padding="compact" className="w-[280px]" aria-label="Traits">
            {model.efforts.length > 0 && (
              <div role="radiogroup" aria-label="Reasoning" className="flex flex-col gap-px">
                <p className={`m-0 ${GROUP_LABEL}`}>Reasoning</p>
                {model.efforts.map((level) => (
                  <RadioRow
                    key={level}
                    checked={effort === level}
                    label={effortLabel(level)}
                    {...(provider === "claude" && CLAUDE_EFFORTS[level] ? { hint: CLAUDE_EFFORTS[level].hint } : {})}
                    {...(model.defaultEffort === level ? { badge: "Default" } : {})}
                    onSelect={() => onChange({ ...traits, effort: level as NonNullable<Traits["effort"]> })}
                  />
                ))}
              </div>
            )}
            {model.thinking === true && (
              <div role="radiogroup" aria-label="Thinking" className="flex flex-col gap-px">
                <p className={`m-0 ${GROUP_LABEL}`}>Thinking</p>
                <RadioRow checked={traits.thinking === true} label="On" onSelect={() => onChange({ ...traits, thinking: true })} />
                <RadioRow checked={traits.thinking !== true} label="Off" onSelect={() => onChange({ ...traits, thinking: false })} />
              </div>
            )}
            {model.fastMode === true && (
              <div role="radiogroup" aria-label="Fast mode" className="flex flex-col gap-px">
                <p className={`m-0 ${GROUP_LABEL}`}>Fast mode</p>
                <RadioRow checked={traits.fastMode === true} label="On" onSelect={() => onChange({ ...traits, fastMode: true })} />
                <RadioRow checked={traits.fastMode !== true} label="Off" onSelect={() => onChange({ ...traits, fastMode: false })} />
              </div>
            )}
      </PopoverPopup>
    </Popover>
  );
};

// ---------------------------------------------------------------------------------------
// The runtime mode picker.

export const RUNTIME_MODES: ReadonlyArray<{ readonly mode: RuntimeMode; readonly label: string; readonly description: string; readonly icon: LucideIcon }> = [
  { mode: "approval-required", label: "Supervised", description: "Ask before commands and file changes.", icon: Lock },
  { mode: "auto-accept-edits", label: "Auto-accept edits", description: "Auto-approve edits, ask before other actions.", icon: PencilLine },
  { mode: "auto", label: "Auto", description: "Supported providers approve routine actions; others still ask.", icon: Sparkles },
  { mode: "full-access", label: "Full access", description: "Allow commands and edits without prompts.", icon: LockOpen },
];

// ---------------------------------------------------------------------------------------
// t3code's compact controls menu.

/**
 * The access mode, and the plan mode when it is on, in one "More composer controls" menu,
 * as t3code shows them below its compact footer width (620 px): every composer here is
 * narrower. Usable while a turn runs; the next tool call reads the access mode.
 */
export const CompactControlsMenu = ({
  runtimeMode,
  onRuntimeMode,
  interactionMode,
  onInteractionMode,
  open,
  onOpenChange,
}: {
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeMode: (mode: RuntimeMode) => void;
  /** Present only while plan mode is on. */
  readonly interactionMode?: InteractionMode;
  readonly onInteractionMode?: (mode: InteractionMode) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => (
  <Menu open={open} onOpenChange={onOpenChange}>
    <MenuTrigger render={<Button variant="ghost-muted" size="icon-sm" aria-label="More composer controls" />}>
      <Ellipsis aria-hidden />
    </MenuTrigger>
    <MenuPopup side="top" align="start" className="w-[300px]">
      {interactionMode !== undefined && onInteractionMode && (
        <>
          <MenuGroup>
            <MenuGroupLabel>Mode</MenuGroupLabel>
            <MenuRadioGroup value={interactionMode} onValueChange={(value) => value !== interactionMode && onInteractionMode(value as InteractionMode)}>
              <MenuRadioItem value="default">Build</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
        </>
      )}
      <MenuGroup>
        <MenuGroupLabel>Access</MenuGroupLabel>
        <MenuRadioGroup value={runtimeMode} onValueChange={(value) => value !== runtimeMode && onRuntimeMode(value as RuntimeMode)}>
          {RUNTIME_MODES.map((entry) => {
            const Icon = entry.icon;
            return (
              <MenuRadioItem key={entry.mode} value={entry.mode}>
                <span className="flex min-w-0 items-start gap-2">
                  <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span>{entry.label}</span>
                    <span className="text-xs text-muted-foreground">{entry.description}</span>
                  </span>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

// ---------------------------------------------------------------------------------------
// The context window meter.

/** The chat's latest token usage, from spec 07's context window activities. */
export const latestUsage = (chat: Chat | undefined): ContextUsage | undefined => {
  for (const activity of [...(chat?.activities ?? [])].reverse()) {
    if (activity.kind !== "context-window.updated") continue;
    const payload = record(activity.payload);
    const usage = record(payload.usage ?? payload);
    if (typeof usage.usedTokens !== "number") continue;
    return {
      usedTokens: usage.usedTokens,
      ...(typeof usage.maxTokens === "number" ? { maxTokens: usage.maxTokens } : {}),
      ...(typeof usage.totalProcessedTokens === "number" ? { totalProcessedTokens: usage.totalProcessedTokens } : {}),
    };
  }
  return undefined;
};

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring filled to the share of the context window used; hovering shows the numbers and Compact context. */
export const ContextMeter = ({ usage, onCompact, compactUnavailable }: { readonly usage: ContextUsage; readonly onCompact: () => void; readonly compactUnavailable: boolean }) => {
  const view = useMemo(() => contextMeter(usage), [usage]);
  const filled = view.percent ?? 0;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={view.label}
        data-testid="context-meter"
        data-overloaded={view.overloaded ? "" : undefined}
      >
        <span className="relative flex size-5 items-center justify-center">
          <svg viewBox="0 0 24 24" className="absolute inset-0 mx-0! size-full -rotate-90" aria-hidden>
            <circle cx="12" cy="12" r={RADIUS} fill="none" className="stroke-muted-foreground/24" strokeWidth="3" />
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              className={view.overloaded ? "stroke-error transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none" : "stroke-highlight transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"}
              data-testid="context-ring"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - filled / 100)}
            />
          </svg>
        </span>
      </PopoverTrigger>
      <PopoverPopup tooltipStyle side="top" align="end" sideOffset={6} padding="none" width="sm" aria-label="Context Window">
        <div className="flex flex-col gap-2 p-(--floating-content-inset) text-left whitespace-normal">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">Context Window</span>
            <span className="text-2xs text-secondary-label tabular-nums" data-testid="context-numbers">
              {view.percentText !== null ? `${view.percentText} · ${view.usedText}/${view.maxText}` : view.usedText}
            </span>
          </div>
          {view.percent !== null && (
            <div role="progressbar" aria-label="Context window usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
              <div className={view.overloaded ? "h-full rounded-full bg-error" : "h-full rounded-full bg-highlight"} style={{ width: `${filled}%` }} />
            </div>
          )}
          {view.totalProcessedText !== null && (
            <div className="flex items-center justify-between gap-3 text-2xs leading-4">
              <span className="text-secondary-label">Total processed</span>
              <span className="font-medium text-secondary-label tabular-nums">{view.totalProcessedText}</span>
            </div>
          )}
          <p className="m-0 mt-1 text-2xs font-medium text-pretty text-secondary-label">Context compacts automatically when needed.</p>
          <Button variant="outline" size="xs" className="mt-1 w-full" disabled={compactUnavailable} onClick={onCompact}>
            <Minimize2 aria-hidden />
            Compact context
          </Button>
          {compactUnavailable && <p className="m-0 text-2xs text-pretty text-secondary-label">Compaction is unavailable for this provider</p>}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
