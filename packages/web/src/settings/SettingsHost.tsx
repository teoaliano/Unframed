/**
 * Settings in the chrome (spec 10): the button in the top-right card's Settings slot and the
 * dialog it opens. The pending OpenRouter connection lives here, above the dialog.
 */
import { KeyRound, Settings as Gear } from "lucide-react";
import { useEffect, useMemo } from "react";
import { registerSlot } from "../chrome/slots.ts";
import { iconButtonClass, Tip } from "../chrome/ui.tsx";
import { useEngine } from "../context.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { SettingsUi, useSettingsUi } from "./settingsUi.ts";

const SettingsButton = ({ ui }: { readonly ui: SettingsUi }) => {
  const { settings } = useSettingsUi(ui);
  // Until the first answer the web assumes a key, so the keyless look does not flash for everyone.
  if (settings?.hasKey ?? true) {
    const hint = settings?.keyHint ?? "";
    return (
      <Tip label={`Settings: ${hint === "" ? "" : `key …${hint}, `}default models, output folder`}>
        <button type="button" aria-label="Settings" className={iconButtonClass} onClick={() => ui.open()}>
          <Gear size={20} aria-hidden />
        </button>
      </Tip>
    );
  }
  return (
    <Tip label="No OpenRouter key yet. Click to add one">
      <button
        type="button"
        aria-label="Add your API key"
        data-keyless="true"
        className="flex size-9 cursor-pointer items-center justify-center rounded-element border-0 bg-accent p-0 text-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => ui.open()}
      >
        <KeyRound size={18} aria-hidden />
      </button>
    </Tip>
  );
};

export const SettingsHost = () => {
  const engine = useEngine();
  const ui = useMemo(() => new SettingsUi(engine), [engine]);

  useEffect(() => ui.start(), [ui]);
  useEffect(() => registerSlot("settingsButton", () => <SettingsButton ui={ui} />), [ui]);

  return <SettingsDialog ui={ui} />;
};
