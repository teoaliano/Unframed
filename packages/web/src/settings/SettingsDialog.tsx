import { UnframedError, type ProviderStatuses, type Settings, type SettingsPatch } from "@unframed/contracts";
import { elevenLabsStatusCopy, keyStatusCopy, sendShortcutOf, type SendShortcut } from "@unframed/domain";
import { Bot, CircleAlert, CircleCheck, FolderOpen, Plug, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/ui/tabs";
import { useActivation, useEngine } from "../context.ts";
import { loadCatalogue } from "../generate/catalogue.ts";
import { showNotice } from "../toasts.tsx";
import { Copy, linkClass, ModelSelect, SectionHeading } from "./fields.tsx";
import { FOLLOW_UP_KEY, LocalAgents, PLAN_MODE_KEY, SEND_SHORTCUT_KEY, type FollowUp } from "./LocalAgents.tsx";
import { ConfirmDialog } from "../agent/ConfirmDialog.tsx";
import { OutsideAgents } from "./OutsideAgents.tsx";
import type { SettingsSection } from "./settingsEvents.ts";
import { useSettingsUi, type SettingsUi } from "./settingsUi.ts";

export const KEY_SAVED_MESSAGE = "Key saved. Unframed is ready to generate.";
export const ELEVENLABS_KEY_SAVED_MESSAGE = "ElevenLabs key saved. Audio is ready to generate.";
const ELEVENLABS_REMOVE_WARNING = "This deletes the ElevenLabs key from .env. Audio generation is disabled until you add one.";
const ELEVENLABS_REMOVED = "ElevenLabs key removed.";
const REMOVE_WARNING = "This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.";
const REMOVED_WARNING = "Key removed. Generate is disabled until you add one.";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type Medium = "image" | "text" | "video" | "audio";
const MEDIA: ReadonlyArray<{ readonly medium: Medium; readonly label: string; readonly field: "imageModel" | "textModel" | "videoModel" }> = [
  { medium: "image", label: "Image", field: "imageModel" },
  { medium: "text", label: "Text", field: "textModel" },
  { medium: "video", label: "Video", field: "videoModel" },
];

interface Draft {
  readonly key: string;
  readonly elevenLabsKey: string;
  readonly audioModel: string;
  readonly imageModel: string;
  readonly textModel: string;
  readonly videoModel: string;
  readonly outputDir: string;
  readonly claudePath: string;
  readonly codexPath: string;
  readonly claudeConfigDir: string;
}

const draftOf = (settings: Settings | undefined): Draft => ({
  key: "",
  elevenLabsKey: "",
  audioModel: settings?.audioModel ?? "",
  imageModel: settings?.imageModel ?? "",
  textModel: settings?.textModel ?? "",
  videoModel: settings?.videoModel ?? "",
  outputDir: settings?.outputDir ?? "",
  claudePath: settings?.claudePath ?? "",
  codexPath: settings?.codexPath ?? "",
  claudeConfigDir: settings?.claudeConfigDir ?? "",
});

const SECTIONS: ReadonlyArray<{ readonly id: SettingsSection; readonly label: string; readonly icon: LucideIcon }> = [
  { id: "generation", label: "Generation", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "general", label: "General", icon: SlidersHorizontal },
];

const SECTION_OF_FIELD: Record<keyof SettingsPatch, SettingsSection> = {
  key: "generation",
  imageModel: "generation",
  textModel: "generation",
  videoModel: "generation",
  elevenLabsKey: "generation",
  audioModel: "generation",
  outputDir: "general",
  claudePath: "agents",
  codexPath: "agents",
  claudeConfigDir: "agents",
};

const sectionsWithChanges = (patch: SettingsPatch): ReadonlySet<SettingsSection> =>
  new Set((Object.keys(patch) as Array<keyof SettingsPatch>).map((field) => SECTION_OF_FIELD[field]));

const listOf = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

type Banner = { readonly kind: "error"; readonly message: string } | { readonly kind: "saved" };

/** Only what changed: the key when typed, a model or the folder when set and different, an agent field whenever different ('' clears it). */
const patchOf = (draft: Draft, settings: Settings): SettingsPatch => {
  const patch: { -readonly [K in keyof SettingsPatch]: SettingsPatch[K] } = {};
  if (draft.key.trim() !== "") patch.key = draft.key.trim();
  if (draft.elevenLabsKey.trim() !== "") patch.elevenLabsKey = draft.elevenLabsKey.trim();
  for (const field of ["imageModel", "textModel", "videoModel", "audioModel", "outputDir"] as const) {
    const value = draft[field].trim();
    if (value !== "" && value !== settings[field]) patch[field] = value;
  }
  for (const field of ["claudePath", "codexPath", "claudeConfigDir"] as const) if (draft[field] !== settings[field]) patch[field] = draft[field];
  return patch;
};

export const SettingsDialog = ({ ui }: { readonly ui: SettingsUi }) => {
  const engine = useEngine();
  const activation = useActivation();
  const state = useSettingsUi(ui);
  const { settings, open, section, connection, starting } = state;
  const hasKey = settings?.hasKey ?? true;
  const pending = connection !== undefined || starting;

  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [revealed, setRevealed] = useState(false);
  const [banner, setBanner] = useState<Banner>();
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemoveElevenLabs, setConfirmRemoveElevenLabs] = useState(false);
  const [removingElevenLabs, setRemovingElevenLabs] = useState(false);
  const [elevenLabsWarning, setElevenLabsWarning] = useState<string>();
  const [fieldWarning, setFieldWarning] = useState<string>();
  const [catalogues, setCatalogues] = useState<Partial<Record<Medium, ReadonlyArray<string>>>>({});
  const [statuses, setStatuses] = useState<ProviderStatuses>();
  const [checking, setChecking] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp>("queue");
  const [sendShortcut, setSendShortcut] = useState<SendShortcut>("enter");
  const [planMode, setPlanMode] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const checks = useRef(0);

  // Opening fills the draft from the settings (key field empty) and resets the paste reveal.
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(ui.current().settings));
    setRevealed(false);
    setBanner(undefined);
    setConfirmRemove(false);
    setFieldWarning(undefined);
    setConfirmRemoveElevenLabs(false);
    setElevenLabsWarning(undefined);
    if (ui.current().settings?.hasKey) void ui.fetchKeyStatus();
    if (ui.current().settings?.hasElevenLabsKey) void ui.fetchElevenLabsStatus();
    else ui.clearElevenLabsStatus();
  }, [open, ui]);

  // A Connect click, and a reconnect that landed, clear the key draft and the banner.
  useEffect(() => {
    if (state.resets === 0) return;
    setDraft((current) => ({ ...current, key: "" }));
    setBanner(undefined);
  }, [state.resets]);

  useEffect(() => {
    if (state.report) setBanner({ kind: "error", message: state.report.message });
  }, [state.report]);

  const checkProviders = (refresh: boolean) => {
    const check = ++checks.current;
    setChecking(true);
    engine.call("providers.getStatuses", refresh ? { refresh: true } : {}).then(
      (answer) => check === checks.current && setStatuses(answer),
      () => undefined,
    ).finally(() => check === checks.current && setChecking(false));
  };

  const keyed = open && settings?.hasKey === true;
  const elevenKeyed = open && settings?.hasElevenLabsKey === true;
  useEffect(() => {
    if (!elevenKeyed) return;
    let live = true;
    loadCatalogue(engine, "audio").then(
      (answer) => live && setCatalogues((current) => ({ ...current, audio: answer.models.map((model) => model.id) })),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [elevenKeyed, engine]);
  useEffect(() => {
    if (!keyed) return;
    let live = true;
    for (const { medium } of MEDIA) {
      loadCatalogue(engine, medium).then(
        (answer) => live && setCatalogues((current) => ({ ...current, [medium]: answer.models.map((model) => model.id) })),
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [keyed, engine]);

  useEffect(() => {
    if (!open) return;
    checkProviders(false);
    return engine.subscribe("preferences.subscribe", { keys: [FOLLOW_UP_KEY, PLAN_MODE_KEY, SEND_SHORTCUT_KEY] }, ({ key, value }) => {
      if (key === FOLLOW_UP_KEY) setFollowUp(value === "steer" ? "steer" : "queue");
      if (key === SEND_SHORTCUT_KEY) setSendShortcut(sendShortcutOf(value));
      if (key === PLAN_MODE_KEY) setPlanMode(value === true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engine]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setBanner(undefined);
  };

  const connect = () => {
    ui.connect();
    setBanner(undefined);
  };

  const save = async () => {
    if (!settings || saving) return;
    const patch = patchOf(draft, settings);
    if (Object.keys(patch).length === 0) return ui.close();
    const hadKey = settings.hasKey;
    const hadElevenLabsKey = settings.hasElevenLabsKey;
    setSaving(true);
    try {
      const next = await engine.call("settings.update", patch);
      ui.setSettings(next);
      // The engine cancelled a pending connection; its next poll would report a lost one.
      if (patch.key !== undefined) ui.keyChosen();
      if (!hadKey && patch.key !== undefined) {
        showNotice(KEY_SAVED_MESSAGE, "info");
        ui.close();
        return;
      }
      if (!hadKey && !hadElevenLabsKey && patch.elevenLabsKey !== undefined) {
        showNotice(ELEVENLABS_KEY_SAVED_MESSAGE, "info");
        ui.close();
        return;
      }
      setDraft((current) => ({ ...current, key: "", elevenLabsKey: "" }));
      if (patch.elevenLabsKey !== undefined) {
        ui.clearElevenLabsStatus();
        setElevenLabsWarning(undefined);
        void ui.fetchElevenLabsStatus();
      }
      setBanner({ kind: "saved" });
      if (patch.key !== undefined) ui.clearKeyStatus();
      if (patch.claudePath !== undefined || patch.codexPath !== undefined || patch.claudeConfigDir !== undefined) checkProviders(false);
      if (patch.outputDir !== undefined) void activation.reopen();
    } catch (error) {
      // Only a refused field leaves the attempt alone: the engine cancels it right after validation.
      if (patch.key !== undefined && !(error instanceof UnframedError && error.code === "bad_request")) ui.keyChosen();
      setBanner({ kind: "error", message: messageOf(error) });
    } finally {
      setSaving(false);
    }
  };

  const browse = async () => {
    try {
      const { path } = await engine.call("settings.pickFolder");
      if (path !== "") edit({ outputDir: path });
    } catch (error) {
      setBanner({ kind: "error", message: messageOf(error) });
    }
  };

  const removeKey = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setFieldWarning(REMOVE_WARNING);
      return;
    }
    setRemoving(true);
    try {
      const answer = await engine.call("settings.removeKey");
      ui.setSettings(answer.settings);
      ui.keyChosen();
      ui.clearKeyStatus();
      setDraft((current) => ({ ...current, key: "" }));
      // The key section stays, so the person sees what happened.
      setRevealed(true);
      setFieldWarning(REMOVED_WARNING);
      setBanner(answer.renderCleanupError === undefined ? undefined : { kind: "error", message: answer.renderCleanupError });
    } catch (error) {
      setFieldWarning(undefined);
      setBanner({ kind: "error", message: messageOf(error) });
    } finally {
      setConfirmRemove(false);
      setRemoving(false);
    }
  };

  const removeElevenLabsKey = async () => {
    if (!confirmRemoveElevenLabs) {
      setConfirmRemoveElevenLabs(true);
      setElevenLabsWarning(ELEVENLABS_REMOVE_WARNING);
      return;
    }
    setRemovingElevenLabs(true);
    try {
      const answer = await engine.call("settings.removeElevenLabsKey");
      ui.setSettings(answer.settings);
      ui.clearElevenLabsStatus();
      setDraft((current) => ({ ...current, elevenLabsKey: "" }));
      setElevenLabsWarning(ELEVENLABS_REMOVED);
    } catch (error) {
      setElevenLabsWarning(undefined);
      setBanner({ kind: "error", message: messageOf(error) });
    } finally {
      setConfirmRemoveElevenLabs(false);
      setRemovingElevenLabs(false);
    }
  };

  const setPlanModePreference = (value: boolean) => {
    setPlanMode(value);
    engine.call("preferences.set", { key: PLAN_MODE_KEY, value }).catch((error: unknown) => setBanner({ kind: "error", message: messageOf(error) }));
  };
  const setSendShortcutPreference = (value: SendShortcut) => {
    setSendShortcut(value);
    engine.call("preferences.set", { key: SEND_SHORTCUT_KEY, value }).catch((error: unknown) => setBanner({ kind: "error", message: messageOf(error) }));
  };
  const setFollowUpPreference = (value: FollowUp) => {
    setFollowUp(value);
    engine.call("preferences.set", { key: FOLLOW_UP_KEY, value }).catch((error: unknown) => setBanner({ kind: "error", message: messageOf(error) }));
  };

  const copy = keyStatusCopy({ hasKey, keyHint: settings?.keyHint ?? "", status: state.keyStatus, now: Date.now() });
  const showsKeySection = hasKey || revealed;
  const hasElevenLabsKey = settings?.hasElevenLabsKey === true;
  const elevenLabsCopy = elevenLabsStatusCopy({ hasKey: hasElevenLabsKey, keyHint: settings?.elevenLabsKeyHint ?? "", status: state.elevenLabsStatus });
  const saves =
    section === "agents" || section === "general" || (section === "generation" && (showsKeySection || hasElevenLabsKey || draft.elevenLabsKey.trim() !== ""));

  const generation = (
    <>
      <section className="flex flex-col gap-3" aria-label="OpenRouter">
        <SectionHeading>OpenRouter</SectionHeading>
        {!hasKey && !pending && (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              Unframed has no image model of its own. It sends your prompts to{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className={linkClass}>
                OpenRouter
              </a>
              , which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.
            </p>
            <Button onClick={connect}>Connect OpenRouter</Button>
          </div>
        )}

        {pending && (
          <div className="flex flex-col items-start gap-2" data-testid="settings-waiting">
            <p className="m-0 text-sm text-foreground">Waiting for OpenRouter in your browser…</p>
            {connection !== undefined && (
              <p className="m-0 text-xs text-muted-foreground">
                Didn't open?{" "}
                <a href={connection.authorizeUrl} target="_blank" rel="noreferrer" className={linkClass}>
                  Approve Unframed at OpenRouter
                </a>
                .
              </p>
            )}
            <Button variant="ghost" className="-ml-3" onClick={() => ui.cancel()}>
              Cancel
            </Button>
          </div>
        )}

        {!showsKeySection && (
          <Button variant="ghost" className="-ml-3 self-start" onClick={() => setRevealed(true)}>
            or paste a key instead
          </Button>
        )}

        {showsKeySection && (
          <div className="flex flex-col gap-2">
            {!hasKey && <h4 className="m-0 text-xs font-medium text-muted-foreground">API key</h4>}
            <div className="flex items-center gap-2">
              <Input
                ref={keyField}
                type="password"
                aria-label="API key"
                placeholder="sk-or-v1-…"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                value={draft.key}
                onChange={(event) => {
                  edit({ key: event.target.value });
                  if (confirmRemove) {
                    setConfirmRemove(false);
                    setFieldWarning(undefined);
                  }
                }}
              />
              {hasKey && (
                <Button variant={confirmRemove ? "destructive" : "ghost"} aria-busy={removing || undefined} disabled={removing} onClick={() => void removeKey()}>
                  {removing && <Spinner aria-hidden />}
                  {confirmRemove ? "Yes, remove it" : "Remove key"}
                </Button>
              )}
            </div>
            <p className="m-0 text-xs text-muted-foreground" data-testid="key-status">
              <Copy parts={copy.line} />
            </p>
            {copy.expiry !== undefined && (
              <p className="m-0 text-xs text-foreground" data-testid="key-expiry">
                {copy.expiry}
              </p>
            )}
            {copy.reconnect && !pending && (
              <Button className="self-start" onClick={connect}>
                Reconnect OpenRouter
              </Button>
            )}
            {fieldWarning !== undefined && (
              <p className="m-0 text-xs text-destructive-foreground" data-testid="key-warning">
                {fieldWarning}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-4" aria-label="ElevenLabs">
        <SectionHeading>ElevenLabs</SectionHeading>
        {!hasKey && (
          <p className="m-0 text-xs text-muted-foreground" data-testid="elevenlabs-only-audio">
            Only want audio? Paste an ElevenLabs key here. Images, video and text still need OpenRouter.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              aria-label="ElevenLabs API key"
              placeholder="sk_…"
              spellCheck={false}
              autoComplete="off"
              value={draft.elevenLabsKey}
              onChange={(event) => {
                edit({ elevenLabsKey: event.target.value });
                if (confirmRemoveElevenLabs) {
                  setConfirmRemoveElevenLabs(false);
                  setElevenLabsWarning(undefined);
                }
              }}
            />
            {hasElevenLabsKey && (
              <Button
                variant={confirmRemoveElevenLabs ? "destructive" : "ghost"}
                aria-busy={removingElevenLabs || undefined}
                disabled={removingElevenLabs}
                onClick={() => void removeElevenLabsKey()}
              >
                {removingElevenLabs && <Spinner aria-hidden />}
                {confirmRemoveElevenLabs ? "Yes, remove it" : "Remove key"}
              </Button>
            )}
          </div>
          <p className="m-0 text-xs text-muted-foreground" data-testid="elevenlabs-status">
            {elevenLabsCopy}
          </p>
          {elevenLabsWarning !== undefined && (
            <p className="m-0 text-xs text-destructive-foreground" data-testid="elevenlabs-warning">
              {elevenLabsWarning}
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t pt-4" aria-label="Default models">
        <SectionHeading>Default models</SectionHeading>
        {(hasKey || hasElevenLabsKey) && settings !== undefined ? (
          <>
            {hasKey &&
              MEDIA.map(({ medium, label, field }) => (
                <ModelSelect key={medium} label={label} value={draft[field]} models={catalogues[medium]} onChange={(value) => edit({ [field]: value })} />
              ))}
            {hasElevenLabsKey && <ModelSelect label="Audio" value={draft.audioModel} models={catalogues.audio} onChange={(value) => edit({ audioModel: value })} />}
          </>
        ) : (
          <p className="m-0 text-xs text-muted-foreground" data-testid="models-need-key">
            Connect OpenRouter to choose the models Generate starts on.
          </p>
        )}
      </section>
    </>
  );

  const agents = (
    <LocalAgents
      statuses={statuses}
      checking={checking}
      onCheckAgain={() => checkProviders(true)}
      claudePath={draft.claudePath}
      codexPath={draft.codexPath}
      claudeConfigDir={draft.claudeConfigDir}
      onChange={(field, value) => edit({ [field]: value })}
      sendShortcut={sendShortcut}
      onSendShortcut={setSendShortcutPreference}
      followUp={followUp}
      onFollowUp={setFollowUpPreference}
      planMode={planMode}
      onPlanMode={setPlanModePreference}
    />
  );

  const general = (
    <section className="flex flex-col gap-2">
      <SectionHeading>Output folder</SectionHeading>
      <p className="m-0 text-xs text-muted-foreground">Every project is a folder in here, with its files, sidecars and chats.</p>
      <div className="flex items-center gap-2">
        <Input aria-label="Output folder" placeholder="./output" font="mono" spellCheck={false} autoComplete="off" value={draft.outputDir} onChange={(event) => edit({ outputDir: event.target.value })} />
        <Button variant="outline" onClick={() => void browse()}>
          <FolderOpen aria-hidden />
          Browse…
        </Button>
      </div>
    </section>
  );

  const current = SECTIONS.find((each) => each.id === section) ?? SECTIONS[0]!;
  const showSection = (next: SettingsSection) => {
    ui.showSection(next);
    setBanner(undefined);
  };
  const changed = settings === undefined ? new Set<SettingsSection>() : sectionsWithChanges(patchOf(draft, settings));
  const showsSave = saves || changed.size > 0;
  const requestClose = () => {
    if (changed.size > 0) setConfirmDiscard(true);
    else ui.close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? ui.open() : requestClose())}>
      <DialogPopup
        showCloseButton={false}
        initialFocus={section === "generation" && showsKeySection ? keyField : undefined}
        data-testid="settings-dialog"
        data-section={section}
        className="h-[min(640px,calc(100dvh-3rem))] max-w-[760px] overflow-hidden"
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 border-t">
          <Tabs orientation="vertical" value={section} onValueChange={(next) => showSection(next as SettingsSection)} className="min-h-0 flex-1 flex-row">
            <div className="w-48 shrink-0 border-e bg-muted/40 p-3">
              <TabsList aria-label="Settings sections" variant="sidebar">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <TabsTab key={id} value={id} data-section={id} data-unsaved={changed.has(id) ? "true" : undefined} aria-description={changed.has(id) ? "Unsaved changes" : undefined}>
                    <Icon aria-hidden />
                    {label}
                    {changed.has(id) && <span aria-hidden data-testid="unsaved-mark" className="ms-auto size-1.5 rounded-full bg-highlight" />}
                  </TabsTab>
                ))}
              </TabsList>
            </div>
            <TabsPanel value={section} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="settings-section">
              <DialogPanel data-testid="settings-form">
                <h2 className="m-0 mt-3 text-base font-semibold text-foreground" data-testid="settings-section-title">
                  {current.label}
                </h2>
                {section === "generation" && generation}
                {section === "agents" && agents}
                {section === "connections" && <OutsideAgents hasKey={hasKey} onConnectOpenRouter={() => showSection("generation")} />}
                {section === "general" && general}
              </DialogPanel>
              {banner !== undefined && (
                <div className="px-6 pb-4">
                  {banner.kind === "error" ? (
                    <Alert variant="error">
                      <CircleAlert aria-hidden />
                      <AlertTitle>{banner.message}</AlertTitle>
                    </Alert>
                  ) : (
                    <Alert variant="success" role="status">
                      <CircleCheck aria-hidden />
                      <AlertTitle>Saved to .env</AlertTitle>
                      <AlertDescription>Applied right away, no restart needed.</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </TabsPanel>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={requestClose}>
            Close
          </Button>
          {showsSave && (
            <Button type="submit" aria-busy={saving || undefined} disabled={saving}>
              {saving && <Spinner aria-hidden />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description={`${listOf([...changed].map((id) => SECTIONS.find((each) => each.id === id)?.label ?? id))} ${changed.size === 1 ? "has" : "have"} changes you have not saved. Closing drops them.`}
        actions={[{ label: "Discard changes", destructive: true, onClick: () => ui.close() }]}
      />
    </Dialog>
  );
};
