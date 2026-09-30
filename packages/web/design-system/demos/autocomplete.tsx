import { Search } from "lucide-react";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "~/components/ui/autocomplete";
import { Demos, Row, Section } from "../frame.tsx";

const PROMPTS = ["Neon koi in a rainy alley", "Isometric greenhouse at dusk", "Paper cut mountains, pastel", "Macro shot of frost on glass", "Retro sci-fi book cover"];

const GROUPS = [
  { value: "Recent prompts", items: ["Neon koi in a rainy alley", "Isometric greenhouse at dusk"] },
  { value: "Library", items: ["Paper cut mountains, pastel", "Macro shot of frost on glass", "Retro sci-fi book cover"] },
];

const Example = ({
  size = "default",
  showTrigger = false,
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
  <div className="w-72">
    <Autocomplete items={PROMPTS} disabled={disabled} defaultValue={defaultValue}>
      <AutocompleteInput
        aria-label="Search prompts"
        placeholder="Search prompts"
        size={size}
        showTrigger={showTrigger}
        showClear={showClear}
        {...(startAddon ? { startAddon: <Search /> } : {})}
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No prompt matches.</AutocompleteEmpty>
        <AutocompleteList>
          {(prompt: string) => (
            <AutocompleteItem key={prompt} value={prompt}>
              {prompt}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  </div>
);

export default function AutocompleteDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {(["sm", "default", "lg"] as const).map((size) => (
          <Row key={size} label={size}>
            <Example size={size} />
          </Row>
        ))}
      </Section>
      <Section title="Input options">
        <Row label="showTrigger">
          <Example showTrigger />
        </Row>
        <Row label="showClear">
          <Example showClear defaultValue="Neon koi in a rainy alley" />
        </Row>
        <Row label="startAddon">
          <Example startAddon />
        </Row>
        <Row label="disabled">
          <Example disabled defaultValue="Isometric greenhouse at dusk" />
        </Row>
      </Section>
      <Section title="Groups">
        <Row label="grouped items">
          <div className="w-72">
            <Autocomplete items={GROUPS}>
              <AutocompleteInput aria-label="Search prompts" placeholder="Type to filter" showTrigger />
              <AutocompletePopup>
                <AutocompleteEmpty>No prompt matches.</AutocompleteEmpty>
                <AutocompleteList>
                  {(group: (typeof GROUPS)[number]) => (
                    <AutocompleteGroup key={group.value} items={group.items}>
                      <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>
                      <AutocompleteCollection>
                        {(prompt: string) => (
                          <AutocompleteItem key={prompt} value={prompt}>
                            {prompt}
                          </AutocompleteItem>
                        )}
                      </AutocompleteCollection>
                    </AutocompleteGroup>
                  )}
                </AutocompleteList>
              </AutocompletePopup>
            </Autocomplete>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
