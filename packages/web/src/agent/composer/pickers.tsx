import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import type { AgentProvider, ModelSelection, ProviderModel, ProviderStatuses } from "@unframed/contracts";
import { contextMeter, type Chat, type ContextUsage, type InteractionMode, type RuntimeMode, type Traits } from "@unframed/domain";
import { Bot, Check, ChevronDown, ChevronRight, Lock, LockOpen, Minimize2, PencilLine, PencilRuler, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import claudeLogo from "../../../../../assets/brand/provider-logos/claude.svg?url";
import codexLogo from "../../../../../assets/brand/provider-logos/codex.svg?url";
import { Tip } from "../../chrome/ui.tsx";
import { effectiveModel, modelsOf, PROVIDERS, providerName } from "../providers.ts";

const LOGOS: Record<AgentProvider, string> = { claude: claudeLogo, codex: codexLogo };

export const ProviderLogo = ({ provider, size = 14 }: { readonly provider: AgentProvider; readonly size?: number }) => (
  <span
    role="img"
    aria-label={providerName(provider)}
    data-logo={provider}
    className="unframed-agent-logo"
    style={{ width: size, height: size, mask: `url("${LOGOS[provider]}") center / contain no-repeat`, WebkitMask: `url("${LOGOS[provider]}") center / contain no-repeat` }}
  />
);

const popupClass =
  "z-[1100] rounded-container border border-line bg-[var(--unframed-popover-translucent)] p-1 text-[13px] text-primary shadow-popover outline-none backdrop-blur-[var(--unframed-chrome-blur)]";

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
      <button
        key={model.id}
        type="button"
        role="option"
        aria-selected={index === highlight}
        data-chosen={chosen ? "" : undefined}
        className="unframed-agent-model-row"
        onMouseEnter={() => setHighlight(index)}
        onClick={() => pick(model)}
      >
        <span className="unframed-agent-model-row__name">{model.name}</span>
        {model.description !== "" && <span className="unframed-agent-model-row__description">{model.description}</span>}
        {chosen && <Check size={13} aria-label="Current model" className="ml-auto" />}
      </button>
    );
  };

  const trigger = (
    <Popover.Trigger className="unframed-agent-control" aria-label="Model" data-testid="model-picker" disabled={disabled}>
      <ProviderLogo provider={selection.provider} />
      <span className="unframed-agent-control__label">{current?.name ?? (selection.model === "" ? providerName(selection.provider) : selection.model)}</span>
      <ChevronDown size={12} aria-hidden />
    </Popover.Trigger>
  );

  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {trigger}
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} className="z-[1100]">
          <Popover.Popup className={`${popupClass} w-[300px]`} aria-label="Models">
            <div role="tablist" aria-label="Providers" className="unframed-agent-provider-tabs">
              {PROVIDERS.map((provider) => {
                const locked = providerLocked && provider !== selection.provider;
                const button = (
                  <button
                    key={provider}
                    type="button"
                    role="tab"
                    aria-selected={tab === provider}
                    aria-disabled={locked || undefined}
                    className="unframed-agent-provider-tab"
                    onClick={() => {
                      if (locked) return;
                      setTab(provider);
                      setHighlight(0);
                    }}
                  >
                    <ProviderLogo provider={provider} />
                    {providerName(provider)}
                  </button>
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
              <p className="unframed-agent-picker__note">{status?.message ?? "checking…"}</p>
            ) : (
              <>
                <input
                  className="unframed-agent-picker__search"
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
                <div role="listbox" aria-label={`${providerName(tab)} models`} className="unframed-agent-picker__list">
                  {currentRows.map(row)}
                  {legacyRows.length > 0 && needle === "" && (
                    <button type="button" className="unframed-agent-legacy" aria-expanded={legacyOpen} onClick={() => setLegacyOpen(!legacyOpen)}>
                      <ChevronRight size={13} aria-hidden className="unframed-agent-legacy__chevron" />
                      Legacy models
                      <span className="ml-auto text-secondary">{`${legacyRows.length} models`}</span>
                    </button>
                  )}
                  {(legacyOpen || needle !== "") && legacyRows.map(row)}
                  {all.length === 0 && <p className="unframed-agent-picker__note">No models found</p>}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

const RadioRow = ({ checked, label, hint, badge, onSelect }: { readonly checked: boolean; readonly label: string; readonly hint?: string; readonly badge?: string; readonly onSelect: () => void }) => (
  <button type="button" role="radio" aria-checked={checked} className="unframed-agent-radio" onClick={onSelect}>
    <span className="unframed-agent-radio__dot" data-on={checked ? "" : undefined} />
    <span className="unframed-agent-radio__label">{label}</span>
    {hint !== undefined && <span className="unframed-agent-radio__hint">{hint}</span>}
    {badge !== undefined && <span className="unframed-agent-menu__badge">{badge}</span>}
  </button>
);

/**
 * The traits picker: radio groups for the traits the chosen model declares (its effort
 * levels, thinking, fast mode), the model's default marked. Hidden when it declares none.
 */
export const TraitsPicker = ({ provider, model, traits, disabled, onChange }: { readonly provider: AgentProvider; readonly model: ProviderModel | undefined; readonly traits: Traits; readonly disabled: boolean; readonly onChange: (traits: Traits) => void }) => {
  if (!model || (model.efforts.length === 0 && model.thinking !== true && model.fastMode !== true)) return null;
  const effort = traits.effort ?? model.defaultEffort;
  const labels = [effort !== undefined ? effortLabel(effort) : undefined, traits.thinking === true ? "Thinking" : undefined].filter((label): label is string => label !== undefined);
  return (
    <Popover.Root>
      <Popover.Trigger className="unframed-agent-control" aria-label="Traits" data-testid="traits-picker" disabled={disabled}>
        <span className="unframed-agent-control__label">{labels.length > 0 ? labels.join(" · ") : "Default"}</span>
        {traits.fastMode === true && <Zap size={12} aria-label="Fast mode" />}
        <ChevronDown size={12} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} className="z-[1100]">
          <Popover.Popup className={`${popupClass} w-[280px]`} aria-label="Traits">
            {model.efforts.length > 0 && (
              <div role="radiogroup" aria-label="Reasoning" className="unframed-agent-radios">
                <p className="unframed-agent-radios__heading">Reasoning</p>
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
              <div role="radiogroup" aria-label="Thinking" className="unframed-agent-radios">
                <p className="unframed-agent-radios__heading">Thinking</p>
                <RadioRow checked={traits.thinking === true} label="On" onSelect={() => onChange({ ...traits, thinking: true })} />
                <RadioRow checked={traits.thinking !== true} label="Off" onSelect={() => onChange({ ...traits, thinking: false })} />
              </div>
            )}
            {model.fastMode === true && (
              <div role="radiogroup" aria-label="Fast mode" className="unframed-agent-radios">
                <p className="unframed-agent-radios__heading">Fast mode</p>
                <RadioRow checked={traits.fastMode === true} label="On" onSelect={() => onChange({ ...traits, fastMode: true })} />
                <RadioRow checked={traits.fastMode !== true} label="Off" onSelect={() => onChange({ ...traits, fastMode: false })} />
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

/** A select of the four runtime modes; usable while a turn runs (the next tool call reads it). */
export const RuntimeModePicker = ({ mode, open, onOpenChange, onChange }: { readonly mode: RuntimeMode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onChange: (mode: RuntimeMode) => void }) => {
  const chosen = RUNTIME_MODES.find((known) => known.mode === mode) ?? RUNTIME_MODES[3]!;
  const Icon = chosen.icon;
  return (
    <Select.Root value={mode} open={open} onOpenChange={(next) => onOpenChange(next)} onValueChange={(next) => onChange(next as RuntimeMode)}>
      <Tip label={chosen.description} side="top">
        <Select.Trigger className="unframed-agent-control" aria-label="Runtime mode" data-testid="runtime-mode">
          <Icon size={13} aria-hidden />
          <span className="unframed-agent-control__label">{chosen.label}</span>
          <ChevronDown size={12} aria-hidden />
        </Select.Trigger>
      </Tip>
      <Select.Portal>
        <Select.Positioner side="top" align="start" sideOffset={6} alignItemWithTrigger={false} className="z-[1100]">
          <Select.Popup className={`${popupClass} w-[300px]`}>
            <Select.List>
              {RUNTIME_MODES.map((entry) => {
                const EntryIcon = entry.icon;
                return (
                  <Select.Item key={entry.mode} value={entry.mode} className="unframed-agent-mode">
                    <EntryIcon size={14} aria-hidden className="unframed-agent-mode__icon" />
                    <span className="unframed-agent-mode__text">
                      <Select.ItemText className="unframed-agent-mode__label">{entry.label}</Select.ItemText>
                      <span className="unframed-agent-mode__description">{entry.description}</span>
                    </span>
                    {entry.mode === "full-access" && <span className="unframed-agent-menu__badge">Default</span>}
                    <Select.ItemIndicator className="unframed-agent-mode__check">
                      <Check size={13} aria-hidden />
                    </Select.ItemIndicator>
                  </Select.Item>
                );
              })}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
};

// ---------------------------------------------------------------------------------------
// The plan toggle.

export const PlanToggle = ({ mode, onToggle }: { readonly mode: InteractionMode; readonly onToggle: () => void }) => {
  const plan = mode === "plan";
  return (
    <Tip label={plan ? "Plan mode. Click to return to normal build mode." : "Default mode. Click to enter plan mode."} side="top">
      <button type="button" className="unframed-agent-control" aria-pressed={plan} data-testid="plan-toggle" onClick={onToggle}>
        {plan ? <PencilRuler size={13} aria-hidden /> : <Bot size={13} aria-hidden />}
        <span className="unframed-agent-control__label">{plan ? "Plan" : "Build"}</span>
      </button>
    </Tip>
  );
};

// ---------------------------------------------------------------------------------------
// The context window meter.

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

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
    <Popover.Root>
      <Popover.Trigger openOnHover delay={150} closeDelay={150} className="unframed-agent-control unframed-agent-control--icon" aria-label={view.label} data-testid="context-meter" data-overloaded={view.overloaded ? "" : undefined}>
        <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden className="unframed-agent-ring">
          <circle cx="12" cy="12" r={RADIUS} fill="none" className="unframed-agent-ring__track" strokeWidth="3" />
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            className="unframed-agent-ring__fill"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - filled / 100)}
          />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={6} className="z-[1100]">
          <Popover.Popup className={`${popupClass} w-[240px] p-3`} aria-label="Context Window">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-secondary">Context Window</span>
              <span className="text-[11px] tabular-nums text-secondary" data-testid="context-numbers">
                {view.percentText !== null ? `${view.percentText} · ${view.usedText}/${view.maxText}` : view.usedText}
              </span>
            </div>
            {view.percent !== null && (
              <div role="progressbar" aria-label="Context window usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled)} className="unframed-agent-progress">
                <div style={{ width: `${filled}%` }} data-overloaded={view.overloaded ? "" : undefined} />
              </div>
            )}
            {view.totalProcessedText !== null && (
              <div className="mt-2 flex justify-between text-[11px] text-secondary">
                <span>Total processed</span>
                <span className="tabular-nums">{view.totalProcessedText}</span>
              </div>
            )}
            <p className="m-0 mt-2 text-[11px] text-secondary">Context compacts automatically when needed.</p>
            <button type="button" className="unframed-agent-button mt-2 w-full justify-center" disabled={compactUnavailable} onClick={onCompact}>
              <Minimize2 size={13} aria-hidden />
              Compact context
            </button>
            {compactUnavailable && <p className="m-0 mt-1 text-[11px] text-secondary">Compaction is unavailable for this provider</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};
