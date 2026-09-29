/** The settings dialog's small pieces: section headings, copy with links, the searchable model select. */
import type { CopyPart } from "@unframed/domain";
import { Check } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Combobox, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxPopup, ComboboxSearchInput, ComboboxTrigger } from "~/components/ui/combobox";
import { Label } from "~/components/ui/label";
import { SelectButton } from "~/components/ui/select";

export const SectionHeading = ({ children, end }: { readonly children: ReactNode; readonly end?: ReactNode }) => (
  <div className="flex min-h-7 items-center justify-between gap-2">
    <h3 className="m-0 text-sm font-medium text-foreground">{children}</h3>
    {end}
  </div>
);

export const linkClass = "text-foreground underline underline-offset-2 hover:opacity-80";

/** A line of copy whose link parts open in a new tab. */
export const Copy = ({ parts }: { readonly parts: ReadonlyArray<CopyPart> }) => (
  <>
    {parts.map((part, index) =>
      typeof part === "string" ? (
        <span key={index}>{part}</span>
      ) : (
        <a key={index} href={part.href} target="_blank" rel="noreferrer" className={linkClass}>
          {part.text}
        </a>
      ),
    )}
  </>
);

/**
 * A searchable select of model ids: the kit Combobox behind a select-looking trigger, with
 * the search field in the popup. Before its catalogue loads, the saved model is the only
 * option and the placeholder says the list is loading.
 */
export const ModelSelect = ({
  label,
  value,
  models,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly models: ReadonlyArray<string> | undefined;
  readonly onChange: (value: string) => void;
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const items = models === undefined ? (value === "" ? [] : [value]) : models.includes(value) || value === "" ? [...models] : [value, ...models];
  const placeholder = models === undefined ? "Loading models…" : "Pick a model";
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={id} render={<span />}>
        {label}
      </Label>
      <Combobox items={items} value={value === "" ? null : value} onValueChange={(next) => typeof next === "string" && onChange(next)} open={open} onOpenChange={setOpen}>
        <ComboboxTrigger
          aria-labelledby={id}
          data-model-select={label}
          render={<SelectButton />}
          onKeyDown={(event) => {
            // Until focus reaches the search field, an Escape lands here, and the settings
            // dialog would close with the list.
            if (open && event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {value === "" ? <span className="text-placeholder">{placeholder}</span> : value}
        </ComboboxTrigger>
        <ComboboxPopup aria-label={`${label} models`}>
          <ComboboxSearchInput aria-label={`Search ${label.toLowerCase()} models`} placeholder="Search models" />
          <ComboboxEmpty>No model matches.</ComboboxEmpty>
          <ComboboxList>
            {(model: string) => (
              <ComboboxItem key={model} value={model}>
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {model === value && <Check aria-hidden className="size-3.5" />}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
};
