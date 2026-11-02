/**
 * The Instance section (spec 20): a selected instance's variants and properties, from the version
 * its page pins. Each change is an attribute on the instance, shown in the frame at once and
 * written as one source edit when the burst commits. An attribute a script sets is read-only.
 */
import type { ComponentDeclaration } from "@unframed/domain";
import { Component } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tip } from "../../chrome/ui.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ImagePicker } from "./ImagePicker.tsx";

/** One variant or property of an instance, as the section shows it. */
export interface InstanceField {
  readonly name: string;
  readonly type: "variant" | "text" | "boolean" | "image";
  /** A variant's values, the first the default. */
  readonly values: readonly string[];
  /** The value on screen: the live attribute, a variant's default when the attribute is absent, or null. */
  readonly value: string | null;
  /** True when a script sets the attribute, so the source does not: read-only (spec 18's owner rule). */
  readonly fixed: boolean;
}

/**
 * The fields of an instance. Its attribute is literal in the source when the live value matches what the
 * source says: a variant's absent attribute counts as its default, and a property's as absent. An edit
 * still in the burst is the person's own, so its field stays editable.
 */
export const instanceFieldsOf = (input: {
  readonly declaration: ComponentDeclaration;
  /** The live attribute of each declared name, null when absent. */
  readonly attributes: Readonly<Record<string, string | null>>;
  /** The attributes the source holds, by name. */
  readonly source: Readonly<Record<string, string>>;
  /** The names with an attribute edit still in the burst. */
  readonly pending: ReadonlySet<string>;
}): InstanceField[] => {
  const { declaration, attributes, source, pending } = input;
  const fields: InstanceField[] = [];
  for (const [name, values] of Object.entries(declaration.variants)) {
    const fallback = values[0] ?? null;
    const live = attributes[name] ?? fallback;
    const literal = (source[name] ?? fallback) === live;
    fields.push({ name, type: "variant", values, value: live, fixed: !literal && !pending.has(name) });
  }
  for (const [name, type] of Object.entries(declaration.props)) {
    const live = attributes[name] ?? null;
    const literal = (source[name] ?? null) === live;
    fields.push({ name, type, values: [], value: live, fixed: !literal && !pending.has(name) });
  }
  return fields;
};

export interface InstanceSectionProps {
  /** The component's name: its title, or its tag when its shape is gone. */
  readonly title: string;
  /** Opens the main component's editor, or null when no component shape holds the tag (its shape was deleted). */
  readonly goToMain: (() => void) | null;
  readonly fields: readonly InstanceField[];
  readonly project: string;
  /** Sets a variant or property attribute; null removes it (a variant's default, a property's absence). */
  readonly onSet: (name: string, value: string | null) => void;
  /** Asks the agent to make a fixed attribute editable. */
  readonly onAsk: (name: string) => void;
}

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
    <span className="truncate text-sm text-muted-foreground">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

/** A text property's field. It keeps what the person types, and writes each change; an empty field restores the sheet's text. */
const TextField = ({ label, value, disabled, onChange }: { readonly label: string; readonly value: string | null; readonly disabled: boolean; readonly onChange: (next: string | null) => void }) => {
  const [draft, setDraft] = useState(value ?? "");
  // The value from outside (the frame, the agent, undo) wins over an old draft.
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <Input
      aria-label={label}
      value={draft}
      disabled={disabled}
      placeholder="Sheet text"
      maxLength={500}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(event.target.value === "" ? null : event.target.value);
      }}
    />
  );
};

export const InstanceSection = ({ title, goToMain, fields, project, onSet, onAsk }: InstanceSectionProps) => (
  <section aria-label="Instance" data-testid="instance-section" className="flex flex-col gap-2 border-b pb-3">
    <div className="flex min-w-0 items-center gap-2">
      <Component aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
      <span className="ml-auto shrink-0">
        {goToMain === null ? (
          // aria-disabled, not disabled: a disabled button would not show its tooltip.
          <Tip label="The main component was deleted.">
            <Button variant="ghost" size="xs" aria-disabled="true">
              Go to main component
            </Button>
          </Tip>
        ) : (
          <Button variant="ghost" size="xs" onClick={goToMain}>
            Go to main component
          </Button>
        )}
      </span>
    </div>
    {fields.map((field) => (
      <div key={field.name} className="flex flex-col gap-1">
        <Row label={field.name}>
          {field.type === "variant" && (
            <Select value={field.value} disabled={field.fixed} onValueChange={(next) => next && onSet(field.name, String(next) === field.values[0] ? null : String(next))}>
              <SelectTrigger aria-label={field.name}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {field.values.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          {field.type === "text" && <TextField label={field.name} value={field.value} disabled={field.fixed} onChange={(next) => onSet(field.name, next)} />}
          {field.type === "boolean" && (
            <Switch aria-label={field.name} checked={field.value !== null} disabled={field.fixed} onCheckedChange={(next) => onSet(field.name, next ? "" : null)} />
          )}
          {field.type === "image" && (
            <div className="flex min-w-0 items-center gap-2">
              {!field.fixed && <ImagePicker project={project} onChoose={(file) => onSet(field.name, file)} />}
              {field.value !== null && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{field.value}</span>}
            </div>
          )}
        </Row>
        {field.fixed && (
          <>
            <p className="m-0 text-xs text-muted-foreground">Set by the agent's code.</p>
            <Button variant="ghost" size="xs" className="self-start" onClick={() => onAsk(field.name)}>
              Ask the agent to make this editable
            </Button>
          </>
        )}
      </div>
    ))}
  </section>
);
