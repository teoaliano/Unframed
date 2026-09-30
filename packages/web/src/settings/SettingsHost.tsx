/**
 * Settings in the chrome (spec 10): the button in the top-right card's Settings slot and the
 * dialog it opens. The pending OpenRouter connection lives here, above the dialog.
 */
import { KeyRound, Settings as Gear } from "lucide-react";
import { useEffect, useMemo } from "react";
import { registerSlot } from "../chrome/slots.ts";
import { Button } from "~/components/ui/button";
import { Tip } from "../chrome/ui.tsx";
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
        <Button variant="ghost" size="icon-lg" aria-label="Settings" onClick={() => ui.open()}>
          <Gear aria-hidden />
        </Button>
      </Tip>
    );
  }
  return (
    <Tip label="No OpenRouter key yet. Click to add one">
      <Button size="icon-lg" aria-label="Add your API key" data-keyless="true" onClick={() => ui.open()}>
        <KeyRound aria-hidden />
      </Button>
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
