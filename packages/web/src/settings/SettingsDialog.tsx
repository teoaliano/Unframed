/**
 * The settings dialog (spec 10): the OpenRouter block (connect, paste, remove, key status),
 * default models, the output folder and the local agents. Save sends only what changed.
 */
import { Dialog } from "@base-ui/react/dialog";
import { UnframedError, type ProviderStatuses, type Settings, type SettingsPatch } from "@unframed/contracts";
import { keyStatusCopy } from "@unframed/domain";
import { CircleCheck, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActivation, useEngine } from "../context.ts";
import { loadCatalogue } from "../generate/catalogue.ts";
import { showNotice } from "../toasts.tsx";
import { Button, Copy, linkClass, ModelSelect, SectionHeading, TextField } from "./fields.tsx";
import { FOLLOW_UP_KEY, LocalAgents, type FollowUp } from "./LocalAgents.tsx";
import { useSettingsUi, type SettingsUi } from "./settingsUi.ts";

export const KEY_SAVED_MESSAGE = "Key saved. Unframed is ready to generate.";
const REMOVE_WARNING = "This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.";
const REMOVED_WARNING = "Key removed. Generate is disabled until you add one.";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type Medium = "image" | "text" | "video";
const MEDIA: ReadonlyArray<{ readonly medium: Medium; readonly label: string; readonly field: "imageModel" | "textModel" | "videoModel" }> = [
  { medium: "image", label: "Image", field: "imageModel" },
  { medium: "text", label: "Text", field: "textModel" },
  { medium: "video", label: "Video", field: "videoModel" },
];

interface Draft {
  readonly key: string;
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
  imageModel: settings?.imageModel ?? "",
  textModel: settings?.textModel ?? "",
  videoModel: settings?.videoModel ?? "",
  outputDir: settings?.outputDir ?? "",
  claudePath: settings?.claudePath ?? "",
  codexPath: settings?.codexPath ?? "",
  claudeConfigDir: settings?.claudeConfigDir ?? "",
});

type Banner = { readonly kind: "error"; readonly message: string } | { readonly kind: "saved" };

/** Only what changed: the key when typed, a model or the folder when set and different, an agent field whenever different ('' clears it). */
const patchOf = (draft: Draft, settings: Settings): SettingsPatch => {
  const patch: { -readonly [K in keyof SettingsPatch]: SettingsPatch[K] } = {};
  if (draft.key.trim() !== "") patch.key = draft.key.trim();
  for (const field of ["imageModel", "textModel", "videoModel", "outputDir"] as const) {
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
  const { settings, open, connection, starting } = state;
  const hasKey = settings?.hasKey ?? true;
  const pending = connection !== undefined || starting;

  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [revealed, setRevealed] = useState(false);
  const [banner, setBanner] = useState<Banner>();
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [fieldWarning, setFieldWarning] = useState<string>();
  const [catalogues, setCatalogues] = useState<Partial<Record<Medium, ReadonlyArray<string>>>>({});
  const [statuses, setStatuses] = useState<ProviderStatuses>();
  const [checking, setChecking] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp>("queue");
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
    if (ui.current().settings?.hasKey) void ui.fetchKeyStatus();
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

  // Sections 5 to 7 need the key: their catalogues are fetched with it.
  const showsFullForm = open && settings?.hasKey === true;
  useEffect(() => {
    if (!showsFullForm) return;
    let live = true;
    for (const { medium } of MEDIA) {
      loadCatalogue(engine, medium).then(
        (answer) => live && setCatalogues((current) => ({ ...current, [medium]: answer.models.map((model) => model.id) })),
        () => undefined,
      );
    }
    checkProviders(false);
    const stop = engine.subscribe("preferences.subscribe", { keys: [FOLLOW_UP_KEY] }, ({ key, value }) => {
      if (key === FOLLOW_UP_KEY) setFollowUp(value === "steer" ? "steer" : "queue");
    });
    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showsFullForm, engine]);

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
    setSaving(true);
    try {
      const next = await engine.call("settings.update", patch);
      ui.setSettings(next);
      // The engine cancelled a pending connection; its next poll would report a lost one.
      if (patch.key !== undefined) ui.keyChosen();
      if (!hadKey) {
        showNotice(KEY_SAVED_MESSAGE, "info");
        ui.close();
        return;
      }
      setDraft((current) => ({ ...current, key: "" }));
      setBanner({ kind: "saved" });
      if (patch.key !== undefined) ui.clearKeyStatus();
      if (patch.claudePath !== undefined || patch.codexPath !== undefined || patch.claudeConfigDir !== undefined) checkProviders(false);
      if (patch.outputDir !== undefined) void activation.reopen();
    } catch (error) {
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

  const setFollowUpPreference = (value: FollowUp) => {
    setFollowUp(value);
    engine.call("preferences.set", { key: FOLLOW_UP_KEY, value }).catch((error: unknown) => setBanner({ kind: "error", message: messageOf(error) }));
  };

  const copy = keyStatusCopy({ hasKey, keyHint: settings?.keyHint ?? "", status: state.keyStatus, now: Date.now() });
  const showsKeySection = hasKey || revealed;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? ui.open() : ui.close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1200] bg-[var(--unframed-scrim)] backdrop-blur-[10px] backdrop-saturate-[160%]" />
        <Dialog.Popup
          initialFocus={showsKeySection ? keyField : undefined}
          data-testid="settings-dialog"
          className="fixed left-1/2 top-1/2 z-[1201] flex max-h-[calc(100vh-32px)] w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-container border border-line bg-popover text-primary shadow-popover outline-none"
        >
          <Dialog.Title className="m-0 px-5 pb-1 pt-5 text-[17px] font-semibold">{hasKey ? "Settings" : "Connect OpenRouter to start"}</Dialog.Title>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-3" data-testid="settings-form">
              {!hasKey && !pending && (
                <section className="flex flex-col items-start gap-3">
                  <p className="m-0 text-[13.5px] leading-relaxed text-secondary">
                    Unframed has no image model of its own. It sends your prompts to{" "}
                    <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className={linkClass}>
                      OpenRouter
                    </a>
                    , which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.
                  </p>
                  <Button variant="primary" onClick={connect}>
                    Connect OpenRouter
                  </Button>
                </section>
              )}

              {pending && (
                <section className="flex flex-col items-start gap-2" data-testid="settings-waiting">
                  <p className="m-0 text-[13.5px] text-primary">Waiting for OpenRouter in your browser…</p>
                  {connection !== undefined && (
                    <p className="m-0 text-[12.5px] text-secondary">
                      Didn't open?{" "}
                      <a href={connection.authorizeUrl} target="_blank" rel="noreferrer" className={linkClass}>
                        Approve Unframed at OpenRouter
                      </a>
                      .
                    </p>
                  )}
                  <Button variant="ghost" className="-ml-2" onClick={() => ui.cancel()}>
                    Cancel
                  </Button>
                </section>
              )}

              {!showsKeySection && (
                <Button variant="ghost" className="-ml-2 self-start" onClick={() => setRevealed(true)}>
                  or paste a key instead
                </Button>
              )}

              {showsKeySection && (
                <section className="flex flex-col gap-2">
                  <SectionHeading>{hasKey ? "OpenRouter" : "API key"}</SectionHeading>
                  <div className="flex items-center gap-2">
                    <TextField
                      ref={keyField}
                      type="password"
                      aria-label="API key"
                      placeholder="sk-or-v1-…"
                      autoFocus
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
                      <Button variant={confirmRemove ? "destructive" : "ghost"} loading={removing} disabled={removing} onClick={() => void removeKey()}>
                        {confirmRemove ? "Yes, remove it" : "Remove key"}
                      </Button>
                    )}
                  </div>
                  <p className="m-0 text-[12.5px] leading-snug text-secondary" data-testid="key-status">
                    <Copy parts={copy.line} />
                  </p>
                  {copy.expiry !== undefined && (
                    <p className="m-0 text-[12.5px] leading-snug text-primary" data-testid="key-expiry">
                      {copy.expiry}
                    </p>
                  )}
                  {copy.reconnect && !pending && (
                    <Button variant="primary" className="self-start" onClick={connect}>
                      Reconnect OpenRouter
                    </Button>
                  )}
                  {fieldWarning !== undefined && (
                    <p className="m-0 text-[12.5px] leading-snug text-error" data-testid="key-warning">
                      {fieldWarning}
                    </p>
                  )}
                </section>
              )}

              {hasKey && settings !== undefined && (
                <>
                  <section className="flex flex-col gap-3 border-t border-line pt-4" aria-label="Default models">
                    <SectionHeading>Default models</SectionHeading>
                    {MEDIA.map(({ medium, label, field }) => (
                      <ModelSelect key={medium} label={label} value={draft[field]} models={catalogues[medium]} onChange={(value) => edit({ [field]: value })} />
                    ))}
                  </section>

                  <section className="flex flex-col gap-2 border-t border-line pt-4" aria-label="Output folder">
                    <SectionHeading>Output folder</SectionHeading>
                    <div className="flex items-center gap-2">
                      <TextField aria-label="Output folder" placeholder="./output" value={draft.outputDir} onChange={(event) => edit({ outputDir: event.target.value })} />
                      <Button variant="secondary" onClick={() => void browse()}>
                        <FolderOpen size={15} aria-hidden />
                        Browse…
                      </Button>
                    </div>
                  </section>

                  <LocalAgents
                    statuses={statuses}
                    checking={checking}
                    onCheckAgain={() => checkProviders(true)}
                    claudePath={draft.claudePath}
                    codexPath={draft.codexPath}
                    claudeConfigDir={draft.claudeConfigDir}
                    onChange={(field, value) => edit({ [field]: value })}
                    followUp={followUp}
                    onFollowUp={setFollowUpPreference}
                  />
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-line px-5 pb-5 pt-3">
              {banner?.kind === "error" && (
                <div role="alert" className="rounded-element border border-[var(--unframed-hue-red-bg)] bg-[var(--unframed-hue-red-bg)] px-3 py-2 text-[12.5px] leading-snug text-[var(--unframed-hue-red-text)]">
                  {banner.message}
                </div>
              )}
              {banner?.kind === "saved" && (
                <div role="status" className="flex items-start gap-2 rounded-element border border-line bg-surface px-3 py-2 text-[12.5px] leading-snug">
                  <CircleCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-icon" />
                  <span className="flex flex-col">
                    <span className="font-medium text-primary">Saved to .env</span>
                    <span className="text-secondary">Applied right away, no restart needed.</span>
                  </span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => ui.close()}>
                  Close
                </Button>
                {showsKeySection && (
                  <Button variant="primary" type="submit" loading={saving} disabled={saving}>
                    Save
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
