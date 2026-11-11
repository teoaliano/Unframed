import { Fragment } from "react";
import { Button } from "~/components/ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { Tip } from "../../chrome/ui.tsx";
import type { EaseChoice, EaseValue } from "./ease.ts";

const Curve = ({ samples }: { readonly samples: readonly number[] }) => {
  const points = samples.map((value, index) => `${(index / (samples.length - 1)) * 24},${16 - value * 12 - 2}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 24 16" className="h-4 w-6 shrink-0 overflow-visible text-muted-foreground">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
};

interface EasePickerProps {
  readonly label: string;
  readonly choices: readonly EaseChoice[];
  readonly onChoose: (value: EaseValue) => void;
  readonly disabled: boolean;
}

export const EasePicker = ({ label, choices, onChoose, disabled }: EasePickerProps) => {
  const item = (choice: EaseChoice) => {
    const option = (
      <MenuRadioItem value={choice.key} aria-label={choice.label} disabled={choice.disabled} closeOnClick>
        <span className="flex min-w-0 items-center gap-2">
          {choice.samples !== null && <Curve samples={choice.samples} />}
          <span className="truncate">{choice.label}</span>
        </span>
      </MenuRadioItem>
    );
    return choice.disabled ? (
      <Tip label={choice.title}>
        <span className="flex">{option}</span>
      </Tip>
    ) : (
      option
    );
  };
  const plain = choices.filter((choice) => choice.group !== "kit");
  const kit = choices.filter((choice) => choice.group === "kit");
  const checked = choices.find((choice) => choice.checked);
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" aria-label="Ease" disabled={disabled} className="min-w-0 max-w-40 justify-start" />}>
        <span className="truncate font-mono text-xs">{label}</span>
      </MenuTrigger>
      <MenuPopup side="left" align="start" className="max-h-96 w-64 overflow-y-auto">
        <MenuRadioGroup value={checked?.key ?? ""} onValueChange={(key) => {
          const choice = choices.find((candidate) => candidate.key === key);
          if (choice) onChoose(choice.value);
        }}>
          {plain.map((choice) => (
            <Fragment key={choice.key}>{item(choice)}</Fragment>
          ))}
          {kit.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Kit</MenuGroupLabel>
              {kit.map((choice) => (
                <Fragment key={choice.key}>{item(choice)}</Fragment>
              ))}
            </MenuGroup>
          )}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
};
