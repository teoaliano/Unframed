import { Check, Cpu } from "lucide-react";
import { useState } from "react";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { SelectButton } from "~/components/ui/select";
import { Demos, Row, Section } from "../frame.tsx";

const MODELS = [
  "black-forest-labs/flux-2-pro",
  "google/gemini-2.5-flash-image-preview",
  "openai/gpt-image-1",
  "bytedance/seedream-4",
  "google/veo-3",
  "a-very-long-provider-name/an-even-longer-model-identifier-that-truncates",
];

const Items = () => (
  <ComboboxList>
    {(model: string) => (
      <ComboboxItem key={model} value={model} disabled={model === "google/veo-3"}>
        <span className="min-w-0 flex-1 truncate">{model}</span>
      </ComboboxItem>
    )}
  </ComboboxList>
);

const InputExample = ({
  size = "default",
  showTrigger = true,
  showClear = false,
  startAddon = false,
  disabled,
  defaultValue,
}: {
  readonly size?: "sm" | "default" | "lg";
  readonly showTrigger?: boolean;
  readonly showClear?: boolean;
  readonly startAddon?: boolean;
  readonly disabled?: boolean;
  readonly defaultValue?: string;
}) => (
  <div className="w-80">
    <Combobox items={MODELS} disabled={disabled} defaultValue={defaultValue ?? null}>
      <ComboboxInput
        aria-label="Model"
        placeholder="Pick a model"
        size={size}
        showTrigger={showTrigger}
        showClear={showClear}
        {...(startAddon ? { startAddon: <Cpu /> } : {})}
      />
      <ComboboxPopup>
        <ComboboxEmpty>No model matches.</ComboboxEmpty>
        <Items />
      </ComboboxPopup>
    </Combobox>
  </div>
);

const SelectLike = () => {
  const [value, setValue] = useState<string | null>("openai/gpt-image-1");
  return (
    <div className="w-80">
      <Combobox items={MODELS} value={value} onValueChange={setValue}>
        <ComboboxTrigger aria-label="Image model" render={<SelectButton />}>
          {value ?? <span className="text-placeholder">Pick a model</span>}
        </ComboboxTrigger>
        <ComboboxPopup aria-label="Image models">
          <ComboboxSearchInput aria-label="Search image models" placeholder="Search models" />
          <ComboboxEmpty>No model matches.</ComboboxEmpty>
          <ComboboxList>
            {(model: string) => (
              <ComboboxItem key={model} value={model}>
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {model === value && <Check aria-hidden className="size-3.5" />}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxStatus>{MODELS.length} models from OpenRouter</ComboboxStatus>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
};

export default function ComboboxDemo() {
  return (
    <Demos>
      <Section title="Input sizes">
        {(["sm", "default", "lg"] as const).map((size) => (
          <Row key={size} label={size}>
            <InputExample size={size} />
          </Row>
        ))}
      </Section>
      <Section title="Input options">
        <Row label="no trigger">
          <InputExample showTrigger={false} />
        </Row>
        <Row label="showClear">
          <InputExample showClear defaultValue="openai/gpt-image-1" />
        </Row>
        <Row label="startAddon">
          <InputExample startAddon />
        </Row>
        <Row label="disabled">
          <InputExample disabled defaultValue="bytedance/seedream-4" />
        </Row>
      </Section>
      <Section title="Select-like trigger">
        <Row label="search in popup">
          <SelectLike />
        </Row>
      </Section>
    </Demos>
  );
}
