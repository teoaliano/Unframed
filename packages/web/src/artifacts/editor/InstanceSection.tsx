import type { ComponentDeclaration } from "@unframed/domain";
import { Component } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tip } from "../../chrome/ui.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ImagePicker } from "./ImagePicker.tsx";

export interface InstanceField {
  readonly name: string;
  readonly type: "variant" | "text" | "boolean" | "image";
  readonly values: readonly string[];
  readonly value: string | null;
  readonly fixed: boolean;
}

export const instanceFieldsOf = (input: {
  readonly declaration: ComponentDeclaration;
  readonly attributes: Readonly<Record<string, string | null>>;
  readonly source: Readonly<Record<string, string>>;
  readonly pending: ReadonlySet<string>;
}): InstanceField[] => {
  const { declaration, attributes, source, pending } = input;
  const fields: InstanceField[] = [];
  for (const [name, values] of Object.entries(declaration.variants)) {
    const fallback = values[0] ?? null;
    const live = attributes[name] ?? fallback;
    const literal = (source[name] ?? fallback) === live;
    fields.push({
      name,
      type: "variant",
      values,
      value: live,
      fixed: !literal && !pending.has(name),
    });
  }
  for (const [name, type] of Object.entries(declaration.props)) {
    const live = attributes[name] ?? null;
    const literal = (source[name] ?? null) === live;
    fields.push({
      name,
      type,
      values: [],
      value: live,
      fixed: !literal && !pending.has(name),
    });
  }
  return fields;
};

export interface InstanceSectionProps {
  readonly title: string;
  readonly goToMain: (() => void) | null;
  readonly fields: readonly InstanceField[];
  readonly project: string;
  readonly onSet: (name: string, value: string | null) => void;
  readonly onAsk: (name: string) => void;
  readonly older?: (() => void) | null;
}

const Row = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
    <span className="truncate text-sm text-muted-foreground">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const TextField = ({
  label,
  value,
  disabled,
  describedBy,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly describedBy?: string | undefined;
  readonly onChange: (next: string | null) => void;
}) => {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
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

export const InstanceSection = ({
  title,
  goToMain,
  fields,
  project,
  onSet,
  onAsk,
  older,
}: InstanceSectionProps) => {
  const noteBase = useId();
  return (
    <section
      aria-label="Instance"
      data-testid="instance-section"
      className="flex flex-col gap-2 border-b pb-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Component
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <span className="ml-auto shrink-0">
          {goToMain === null ? (
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
      {older && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{`This instance uses an older version of ${title}.`}</span>
          <Button
            variant="outline"
            size="xs"
            aria-label={`Update ${title}`}
            onClick={older}
          >
            Update
          </Button>
        </div>
      )}
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <Row label={field.name}>
            {field.type === "variant" && (
              <Select
                value={field.value}
                disabled={field.fixed}
                onValueChange={(next) =>
                  next &&
                  onSet(
                    field.name,
                    String(next) === field.values[0] ? null : String(next),
                  )
                }
              >
                <SelectTrigger
                  aria-label={field.name}
                  aria-describedby={
                    field.fixed ? `${noteBase}-${field.name}` : undefined
                  }
                >
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
            {field.type === "text" && (
              <TextField
                label={field.name}
                value={field.value}
                disabled={field.fixed}
                describedBy={
                  field.fixed ? `${noteBase}-${field.name}` : undefined
                }
                onChange={(next) => onSet(field.name, next)}
              />
            )}
            {field.type === "boolean" && (
              <Switch
                aria-label={field.name}
                aria-describedby={
                  field.fixed ? `${noteBase}-${field.name}` : undefined
                }
                checked={field.value !== null}
                disabled={field.fixed}
                onCheckedChange={(next) => onSet(field.name, next ? "" : null)}
              />
            )}
            {field.type === "image" && (
              <div className="flex min-w-0 items-center gap-2">
                {!field.fixed && (
                  <ImagePicker
                    project={project}
                    onChoose={(file) => onSet(field.name, file)}
                  />
                )}
                {field.value !== null && (
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {field.value}
                  </span>
                )}
              </div>
            )}
          </Row>
          {field.fixed && (
            <>
              <p
                id={`${noteBase}-${field.name}`}
                className="m-0 text-xs text-muted-foreground"
              >
                Set by the agent's code.
              </p>
              <Button
                variant="ghost"
                size="xs"
                className="self-start"
                onClick={() => onAsk(field.name)}
              >
                Ask the agent to make this editable
              </Button>
            </>
          )}
        </div>
      ))}
    </section>
  );
};
