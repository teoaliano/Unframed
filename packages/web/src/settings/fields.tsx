/** The settings dialog's small pieces: buttons, fields, the searchable model select and copy with links. */
import { Combobox } from "@base-ui/react/combobox";
import type { CopyPart } from "@unframed/domain";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

const buttonBase =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-element px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60";

const VARIANTS = {
  primary: "border-0 bg-accent text-on-accent hover:opacity-90",
  secondary: "border border-line bg-surface text-primary hover:bg-hover",
  ghost: "border-0 bg-transparent text-primary hover:bg-hover",
  destructive: "border-0 bg-error text-on-accent hover:opacity-90",
} as const;

export const Button = ({
  variant,
  loading = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant: keyof typeof VARIANTS; readonly loading?: boolean }) => (
  <button type="button" className={`${buttonBase} ${VARIANTS[variant]} ${className}`} aria-busy={loading || undefined} {...props}>
    {loading && <Loader2 size={14} aria-hidden className="animate-spin" />}
    {children}
  </button>
);

export const inputClass =
  "h-9 w-full min-w-0 rounded-element border border-line-strong bg-surface px-2.5 text-[13.5px] text-primary outline-none placeholder:text-secondary focus:border-accent";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...props }, ref) => (
  <input ref={ref} className={`${inputClass} ${className}`} spellCheck={false} autoComplete="off" {...props} />
));

export const SectionHeading = ({ children, end }: { readonly children: ReactNode; readonly end?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <h3 className="m-0 text-[13.5px] font-semibold text-primary">{children}</h3>
    {end}
  </div>
);

export const linkClass = "text-primary underline underline-offset-2 hover:opacity-80";

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
 * A searchable select of model ids. Before its catalogue loads, the saved model is the only
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
  const items = models === undefined ? (value === "" ? [] : [value]) : models.includes(value) || value === "" ? [...models] : [value, ...models];
  return (
    <div className="flex flex-col gap-1">
      <Combobox.Root items={items} value={value === "" ? null : value} onValueChange={(next) => typeof next === "string" && onChange(next)}>
        <span id={id} className="text-[12.5px] text-secondary">
          {label}
        </span>
        <Combobox.Trigger
          aria-labelledby={id}
          data-model-select={label}
          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-element border border-line-strong bg-surface px-2.5 text-left text-[13.5px] text-primary outline-none focus-visible:border-accent data-[placeholder]:text-secondary"
        >
          <span className="min-w-0 truncate">
            <Combobox.Value placeholder={models === undefined ? "Loading models…" : "Pick a model"} />
          </span>
          <ChevronDown size={16} aria-hidden className="shrink-0 text-icon-secondary" />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner align="start" sideOffset={4} className="z-[1300]">
            <Combobox.Popup
              aria-label={`${label} models`}
              className="w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-container border border-line bg-popover p-1 text-[13px] text-primary shadow-popover outline-none"
            >
              <div className="flex items-center gap-1.5 border-b border-line px-2 pb-1">
                <Search size={14} aria-hidden className="text-icon-secondary" />
                <Combobox.Input aria-label={`Search ${label.toLowerCase()} models`} placeholder="Search models" className="h-8 w-full border-0 bg-transparent text-[13px] text-primary outline-none placeholder:text-secondary" />
              </div>
              <Combobox.Empty>
                <div className="px-2 py-3 text-secondary">No model matches.</div>
              </Combobox.Empty>
              <Combobox.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain pt-1">
                {(model: string) => (
                  <Combobox.Item key={model} value={model} className="flex h-8 cursor-default items-center gap-2 rounded-inner px-2 outline-none data-[highlighted]:bg-hover">
                    <span className="flex size-4 items-center">
                      <Combobox.ItemIndicator>
                        <Check size={14} aria-hidden />
                      </Combobox.ItemIndicator>
                    </span>
                    <span className="min-w-0 truncate">{model}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
};
