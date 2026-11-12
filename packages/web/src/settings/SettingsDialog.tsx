import { UnframedError, type ProviderStatuses, type Settings, type SettingsPatch } from "@unframed/contracts";
import { ELEVENLABS_KEY, elevenLabsStatusCopy, GENERATION_PROVIDERS, VERCEL_KEY_SAVED_MESSAGE, vercelCreditsCopy, keyStatusCopy, OPENROUTER_KEY, sendShortcutOf, VERCEL_KEY, type SendShortcut } from "@unframed/domain";
import { Bot, CircleAlert, CircleCheck, FolderOpen, Plug, SlidersHorizontal, Sparkles, Tablet, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { useIsDevice } from "../deviceMode.ts";
import { IpadAccess, useIpadAvailable } from "./IpadAccess.tsx";
import { OutsideAgents } from "./OutsideAgents.tsx";
import type { SettingsSection } from "./settingsEvents.ts";
import { useSettingsUi, type SettingsUi } from "./settingsUi.ts";
import { KeyWarning, RemoveKeyButton, useKeyRemoval } from "./keyRemoval.tsx";

export const KEY_SAVED_MESSAGE = "Key saved. Unframed is ready to generate.";
export const ELEVENLABS_KEY_SAVED_MESSAGE = "ElevenLabs key saved. Audio is ready to generate.";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type Medium = "image" | "text" | "video" | "audio" | "vercelImage" | "vercelText";
const MEDIA: ReadonlyArray<{ readonly medium: "image" | "text" | "video"; readonly label: string; readonly field: "imageModel" | "textModel" | "videoModel" }> = [
  { medium: "image", label: "Image", field: "imageModel" },
  { medium: "text", label: "Text", field: "textModel" },
  { medium: "video", label: "Video", field: "videoModel" },
];

interface Draft {
  readonly key: string;
  readonly vercelKey: string;
  readonly vercelImageModel: string;
  readonly vercelTextModel: string;
  readonly elevenLabsKey: string;
  readonly audioModel: string;
  readonly imageModel: string;
  readonly textModel: string;
  readonly videoModel: string;
  readonly outputDir: string;
  readonly claudePath: string;
  readonly codexPath: string;
  readonly claudeConfigDir: string;
  readonly ipadPort: string;
}

const draftOf = (settings: Settings | undefined): Draft => ({
  key: "",
  vercelKey: "",
  vercelImageModel: settings?.vercelImageModel ?? "",
  vercelTextModel: settings?.vercelTextModel ?? "",
  elevenLabsKey: "",
  audioModel: settings?.audioModel ?? "",
  imageModel: settings?.imageModel ?? "",
  textModel: settings?.textModel ?? "",
  videoModel: settings?.videoModel ?? "",
  outputDir: settings?.outputDir ?? "",
  claudePath: settings?.claudePath ?? "",
  codexPath: settings?.codexPath ?? "",
  claudeConfigDir: settings?.claudeConfigDir ?? "",
  ipadPort: settings === undefined ? "" : String(settings.ipadPort),
});

const SECTIONS: ReadonlyArray<{ readonly id: SettingsSection; readonly label: string; readonly icon: LucideIcon }> = [
  { id: "generation", label: "Generation", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "ipad", label: "iPad", icon: Tablet },
  { id: "general", label: "General", icon: SlidersHorizontal },
];

const SECTION_OF_FIELD: Record<keyof SettingsPatch, SettingsSection> = {
  key: "generation",
  imageModel: "generation",
  textModel: "generation",
  videoModel: "generation",
  elevenLabsKey: "generation",
  audioModel: "generation",
  vercelKey: "generation",
  vercelImageModel: "generation",
  vercelTextModel: "generation",
  outputDir: "general",
  claudePath: "agents",
  codexPath: "agents",
  claudeConfigDir: "agents",
  ipadAccess: "ipad",
  ipadPort: "ipad",
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
  if (draft.vercelKey.trim() !== "") patch.vercelKey = draft.vercelKey.trim();
  for (const field of ["imageModel", "textModel", "videoModel", "audioModel", "vercelImageModel", "vercelTextModel", "outputDir"] as const) {
    const value = draft[field].trim();
    if (value !== "" && value !== settings[field]) patch[field] = value;
  }
  for (const field of ["claudePath", "codexPath", "claudeConfigDir"] as const) if (draft[field] !== settings[field]) patch[field] = draft[field];
  if (draft.ipadPort.trim() !== String(settings.ipadPort)) patch.ipadPort = draft.ipadPort.trim();
  return patch;
};

const ModelGroup = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <div className="flex flex-col gap-3" role="group" aria-label={`${title} default models`}>
    <p className="m-0 text-xs font-medium text-(--settings-dialog-label)">{title}</p>
    {children}
  </div>
);

export const SettingsDialog = ({ ui }: { readonly ui: SettingsUi }) => {
  const engine = useEngine();
  const device = useIsDevice();
  const ipadHere = useIpadAvailable() && !device;
  const activation = useActivation();
  const state = useSettingsUi(ui);
  const { settings, open, section, connection, starting } = state;
  const hasKey = settings?.hasKey ?? true;
  const pending = connection !== undefined || starting;

  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [revealed, setRevealed] = useState(false);
  const [banner, setBanner] = useState<Banner>();
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sheetHost, setSheetHost] = useState<HTMLDivElement | null>(null);
  const [paneSheet, setPaneSheet] = useState(false);
  const [catalogues, setCatalogues] = useState<Partial<Record<Medium, ReadonlyArray<string>>>>({});
  const [statuses, setStatuses] = useState<ProviderStatuses>();
  const [checking, setChecking] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp>("queue");
  const [sendShortcut, setSendShortcut] = useState<SendShortcut>("enter");
  const [planMode, setPlanMode] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const checks = useRef(0);
  const resetRemovals = useRef(() => {});
  const [audioModelsProblem, setAudioModelsProblem] = useState<string>();

  // Opening fills the draft from the settings (key field empty) and resets the paste reveal.
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(ui.current().settings));
    setRevealed(false);
    setBanner(undefined);
    resetRemovals.current();
    if (ui.current().settings?.hasKey) void ui.fetchKeyStatus();
    if (ui.current().settings?.hasElevenLabsKey) void ui.fetchElevenLabsStatus();
    else ui.clearElevenLabsStatus();
    if (ui.current().settings?.hasVercelKey) void ui.fetchVercelStatus();
    else ui.clearVercelStatus();
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
  const vercelKeyed = open && settings?.hasVercelKey === true;
  const vercelKeyHint = settings?.vercelKeyHint ?? "";
  useEffect(() => {
    if (!vercelKeyed) return;
    let live = true;
    for (const [medium, field] of [
      ["image", "vercelImage"],
      ["text", "vercelText"],
    ] as const) {
      engine.call("models.list", { medium, provider: "vercel" }).then(
        (answer) => live && setCatalogues((current) => ({ ...current, [field]: answer.models.map((model) => model.id) })),
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [vercelKeyed, vercelKeyHint, engine]);
  const elevenKeyed = open && settings?.hasElevenLabsKey === true;
  const elevenLabsKeyHint = settings?.elevenLabsKeyHint ?? "";
  const [elevenLabsSaves, setElevenLabsSaves] = useState(0);
  useEffect(() => {
    if (!elevenKeyed) return;
    let live = true;
    engine.call("models.list", { medium: "audio" }).then(
      (answer) => {
        if (!live) return;
        setCatalogues((current) => ({ ...current, audio: answer.models.map((model) => model.id) }));
        setAudioModelsProblem(answer.problem);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [elevenKeyed, elevenLabsKeyHint, elevenLabsSaves, engine]);
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
    const hadVercelKey = settings.hasVercelKey;
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
      if (!hadKey && !hadElevenLabsKey && !hadVercelKey && patch.vercelKey !== undefined) {
        showNotice(VERCEL_KEY_SAVED_MESSAGE, "info");
        ui.close();
        return;
      }
      if (!hadKey && !hadElevenLabsKey && !hadVercelKey && patch.elevenLabsKey !== undefined) {
        showNotice(ELEVENLABS_KEY_SAVED_MESSAGE, "info");
        ui.close();
        return;
      }
      setDraft((current) => ({ ...current, key: "", elevenLabsKey: "", vercelKey: "" }));
      if (patch.vercelKey !== undefined) {
        ui.clearVercelStatus();
        vercelRemoval.reset();
        void ui.fetchVercelStatus();
      }
      if (patch.elevenLabsKey !== undefined) {
        setElevenLabsSaves((count) => count + 1);
        ui.clearElevenLabsStatus();
        elevenLabsRemoval.reset();
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

  const openRouterRemoval = useKeyRemoval(
    OPENROUTER_KEY,
    async () => {
      const answer = await engine.call(OPENROUTER_KEY.removeMethod);
      ui.setSettings(answer.settings);
      ui.keyChosen();
      ui.clearKeyStatus();
      setDraft((current) => ({ ...current, key: "" }));
      setRevealed(true);
      setBanner(answer.renderCleanupError === undefined ? undefined : { kind: "error", message: answer.renderCleanupError });
    },
    (message) => setBanner({ kind: "error", message }),
  );

  const elevenLabsRemoval = useKeyRemoval(
    ELEVENLABS_KEY,
    async () => {
      const answer = await engine.call(ELEVENLABS_KEY.removeMethod);
      ui.setSettings(answer.settings);
      ui.clearElevenLabsStatus();
      setDraft((current) => ({ ...current, elevenLabsKey: "" }));
    },
    (message) => setBanner({ kind: "error", message }),
  );
  const vercelRemoval = useKeyRemoval(
    VERCEL_KEY,
    async () => {
      const answer = await engine.call(VERCEL_KEY.removeMethod);
      ui.setSettings(answer.settings);
      ui.clearVercelStatus();
      setDraft((current) => ({ ...current, vercelKey: "" }));
    },
    (message) => setBanner({ kind: "error", message }),
  );
  resetRemovals.current = () => {
    openRouterRemoval.reset();
    vercelRemoval.reset();
    elevenLabsRemoval.reset();
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
  const hasVercelKey = settings?.hasVercelKey === true;
  const vercelCopy = vercelCreditsCopy({ hasKey: hasVercelKey, keyHint: vercelKeyHint, status: state.vercelStatus });
  const saves =
    section === "agents" ||
    section === "ipad" ||
    section === "general" ||
    (section === "generation" && (showsKeySection || hasElevenLabsKey || hasVercelKey || draft.elevenLabsKey.trim() !== "" || draft.vercelKey.trim() !== ""));

  const generation = (
    <>
      <section className="flex flex-col gap-3" aria-label="OpenRouter">
        <SectionHeading>OpenRouter</SectionHeading>
        {!hasKey && !pending && (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-sm leading-relaxed text-(--settings-dialog-description)">
              Unframed has no image model of its own. It sends your prompts to{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className={linkClass}>
                OpenRouter
              </a>
              , which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.
            </p>
            {!device && <Button onClick={connect}>Connect OpenRouter</Button>}
          </div>
        )}

        {pending && (
          <div className="flex flex-col items-start gap-2" data-testid="settings-waiting">
            <p className="m-0 text-sm text-(--settings-dialog-foreground)">Waiting for OpenRouter in your browser…</p>
            {connection !== undefined && (
              <p className="m-0 text-xs text-(--settings-dialog-description)">
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
            {!hasKey && <h4 className="m-0 text-xs font-medium text-(--settings-dialog-label)">API key</h4>}
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
                  openRouterRemoval.typed();
                }}
              />
              {hasKey && <RemoveKeyButton removal={openRouterRemoval} />}
            </div>
            <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="key-status">
              <Copy parts={copy.line} />
            </p>
            {copy.expiry !== undefined && (
              <p className="m-0 text-xs text-(--settings-dialog-foreground)" data-testid="key-expiry">
                {copy.expiry}
              </p>
            )}
            {copy.reconnect && !pending && !device && (
              <Button className="self-start" onClick={connect}>
                Reconnect OpenRouter
              </Button>
            )}
            <KeyWarning removal={openRouterRemoval} testId="key-warning" />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-(--settings-dialog-divider) pt-4" aria-label="Vercel AI Gateway">
        <SectionHeading>Vercel AI Gateway</SectionHeading>
        {!hasKey && (
          <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="vercel-instead">
            No OpenRouter account? Images and text can run through the Vercel AI Gateway instead. Video still needs OpenRouter.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              aria-label="Vercel AI Gateway API key"
              placeholder="vck_…"
              spellCheck={false}
              autoComplete="off"
              value={draft.vercelKey}
              onChange={(event) => {
                edit({ vercelKey: event.target.value });
                vercelRemoval.typed();
              }}
            />
            {hasVercelKey && <RemoveKeyButton removal={vercelRemoval} />}
          </div>
          <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="vercel-status">
            {vercelCopy}
          </p>
          <KeyWarning removal={vercelRemoval} testId="vercel-warning" />
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-(--settings-dialog-divider) pt-4" aria-label="ElevenLabs">
        <SectionHeading>ElevenLabs</SectionHeading>
        {!hasKey && !hasVercelKey && (
          <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="elevenlabs-only-audio">
            Only want audio? Paste an ElevenLabs key here. Images and text need OpenRouter or the Vercel AI Gateway, and video needs OpenRouter.
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
                elevenLabsRemoval.typed();
              }}
            />
            {hasElevenLabsKey && <RemoveKeyButton removal={elevenLabsRemoval} />}
          </div>
          <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="elevenlabs-status">
            {elevenLabsCopy}
          </p>
          <KeyWarning removal={elevenLabsRemoval} testId="elevenlabs-warning" />
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-(--settings-dialog-divider) pt-4" aria-label="Default models">
        <SectionHeading>Default models</SectionHeading>
        {(hasKey || hasVercelKey || hasElevenLabsKey) && settings !== undefined ? (
          <>
            {hasKey && (
              <ModelGroup title={GENERATION_PROVIDERS.openrouter.title}>
                {MEDIA.map(({ medium, label, field }) => (
                  <ModelSelect key={medium} label={label} value={draft[field]} models={catalogues[medium]} onChange={(value) => edit({ [field]: value })} />
                ))}
              </ModelGroup>
            )}
            {hasVercelKey && (
              <ModelGroup title={GENERATION_PROVIDERS.vercel.title}>
                <ModelSelect label="Image" name="Vercel image" value={draft.vercelImageModel} models={catalogues.vercelImage} onChange={(value) => edit({ vercelImageModel: value })} />
                <ModelSelect label="Text" name="Vercel text" value={draft.vercelTextModel} models={catalogues.vercelText} onChange={(value) => edit({ vercelTextModel: value })} />
              </ModelGroup>
            )}
            {hasElevenLabsKey && (
              <ModelGroup title="ElevenLabs">
                <ModelSelect label="Audio" value={draft.audioModel} models={catalogues.audio} onChange={(value) => edit({ audioModel: value })} />
                {audioModelsProblem !== undefined && (
                  <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="audio-models-problem">
                    {audioModelsProblem}
                  </p>
                )}
              </ModelGroup>
            )}
          </>
        ) : (
          <p className="m-0 text-xs text-(--settings-dialog-description)" data-testid="models-need-key">
            Connect OpenRouter or paste a Vercel AI Gateway key to choose the models Generate starts on.
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
      <p className="m-0 text-xs text-(--settings-dialog-description)">Every project is a folder in here, with its files, sidecars and chats.</p>
      <div className="flex items-center gap-2">
        <Input aria-label="Output folder" placeholder="./output" font="mono" spellCheck={false} autoComplete="off" value={draft.outputDir} onChange={(event) => edit({ outputDir: event.target.value })} />
        {!device && (
          <Button variant="outline" onClick={() => void browse()}>
            <FolderOpen aria-hidden />
            Browse…
          </Button>
        )}
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
        className="h-[min(var(--settings-dialog-height),calc(100dvh-(--spacing(12))))] max-w-(--settings-dialog-width) overflow-hidden"
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
        <div className="flex min-h-0 flex-1 border-t border-(--settings-dialog-divider)">
          <Tabs orientation="vertical" value={section} onValueChange={(next) => showSection(next as SettingsSection)} className="min-h-0 flex-1 flex-row">
            <div className="w-48 shrink-0 border-e border-(--settings-dialog-nav-border) bg-(--settings-dialog-nav-surface)/(--settings-dialog-nav-surface-opacity) p-3">
              <TabsList aria-label="Settings sections" variant="sidebar">
                {SECTIONS.filter(({ id }) => id !== "ipad" || ipadHere).map(({ id, label, icon: Icon }) => (
                  <TabsTab key={id} value={id} data-section={id} data-unsaved={changed.has(id) ? "true" : undefined} aria-description={changed.has(id) ? "Unsaved changes" : undefined}>
                    <Icon aria-hidden />
                    {label}
                    {changed.has(id) && <span aria-hidden data-testid="unsaved-mark" className="ms-auto size-1.5 rounded-full bg-(--settings-dialog-unsaved-indicator)" />}
                  </TabsTab>
                ))}
              </TabsList>
            </div>
            <TabsPanel value={section} className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="settings-section">
              <DialogPanel data-testid="settings-form" inert={paneSheet}>
                <h2 className="m-0 mt-3 text-base font-semibold text-(--settings-dialog-foreground)" data-testid="settings-section-title">
                  {current.label}
                </h2>
                {section === "generation" && generation}
                {section === "agents" && agents}
                {section === "connections" && <OutsideAgents hasKey={hasKey} onConnectOpenRouter={() => showSection("generation")} sheetHost={sheetHost} onSheet={setPaneSheet} />}
                {section === "ipad" && ipadHere && settings !== undefined && (
                  <IpadAccess
                    access={settings.ipadAccess}
                    onAccess={async (on) => {
                      const next = await engine.call("settings.update", { ipadAccess: on ? "on" : "" });
                      ui.setSettings(next);
                      setDraft((current) => ({ ...current, ipadPort: String(next.ipadPort) }));
                    }}
                    port={draft.ipadPort}
                    onPort={(value) => edit({ ipadPort: value })}
                  />
                )}
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
              <div ref={setSheetHost} />
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
