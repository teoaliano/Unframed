import type { PropValue } from "@unframed/domain";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ChangedDot } from "../../design/fields.tsx";
import type { EditSession } from "./editSession.ts";
import { InspectorSection, type ScreenFields } from "./ScreenDesign.tsx";
import type { Inspected } from "./ScreenHeader.tsx";

const PROPS = "#props";

const shownProp = (value: PropValue | undefined): string => (value === undefined ? "—" : typeof value === "string" ? JSON.stringify(value) : String(value));

export const InstanceSection = ({ session, fields, inspect, id }: { readonly session: EditSession; readonly fields: ScreenFields; readonly inspect: Inspected; readonly id: string }) => {
  const found = inspect.found;
  if (!found || found.instanceOf === null) return null;
  const props: Readonly<Record<string, PropValue>> = found.props ?? {};
  const axes = (inspect.inspected?.cva ?? []).flatMap((entry) => entry.variants);
  const names = [...new Set([...axes.map((axis) => axis.name), ...Object.keys(props)])];
  if (names.length === 0) return null;
  const draft = fields.draftOf(id, PROPS);
  const asked = draft?.props ?? {};
  const before = draft?.propsBefore ?? {};
  const valueOf = (name: string): PropValue | undefined => (name in asked ? asked[name] : name in props ? props[name] : (axes.find((axis) => axis.name === name)?.default ?? undefined));
  const set = (name: string, value: PropValue) => session.patchStructure(id, { type: "props", props: { [name]: value }, before: { [name]: name in props ? props[name]! : (axes.find((axis) => axis.name === name)?.default ?? null) } });
  const discard = (name: string) => {
    if (draft === undefined) return;
    const rest = Object.fromEntries(Object.entries(asked).filter(([key]) => key !== name));
    session.discardDraft(draft.id);
    if (Object.keys(rest).length > 0) session.patchStructure(id, { type: "props", props: rest, before: Object.fromEntries(Object.keys(rest).map((key) => [key, before[key] ?? null])) });
  };
  return (
    <InspectorSection name="Instance">
      <div className="grid grid-cols-[var(--design-panel-label-width)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        {names.map((name) => {
          const axis = axes.find((each) => each.name === name);
          const value = valueOf(name);
          const change = name in asked ? { before: String(before[name] ?? "none"), discard: () => discard(name) } : undefined;
          return (
            <div key={name} className="contents" data-prop={name}>
              <span className="flex min-w-0 items-center gap-1 text-xs text-(--design-panel-label)">
                <ChangedDot change={change} />
                <span className="truncate">{name}</span>
              </span>
              {axis !== undefined ? (
                <Select value={value === undefined || value === null ? null : String(value)} onValueChange={(next) => next !== null && String(next) !== String(value) && set(name, String(next))}>
                  <SelectTrigger aria-label={name} size="sm">
                    <SelectValue>{value === undefined || value === null ? "—" : String(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {axis.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : typeof value === "boolean" ? (
                <Switch aria-label={name} checked={value} onCheckedChange={(next) => set(name, next)} />
              ) : (
                <code className="min-w-0 truncate font-mono text-xs" title={shownProp(value)}>
                  {shownProp(value)}
                </code>
              )}
            </div>
          );
        })}
      </div>
    </InspectorSection>
  );
};
