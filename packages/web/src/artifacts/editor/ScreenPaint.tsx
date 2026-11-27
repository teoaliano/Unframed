import type { ScaleToken } from "@unframed/contracts";
import { alphaPercent, colourWrite, currentColourToken, hexLabel, withAlpha } from "@unframed/domain";
import { Grip, Minus, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { ColourPicker, ColourRow } from "../../design/colourPicker.tsx";
import type { EditSession } from "./editSession.ts";
import { InspectorSection, type ScreenFields, type ScreenSubject } from "./ScreenDesign.tsx";

const COLOUR_PROPERTIES = ["color", "background-color", "border-color"];

export const coloursOnPage = (session: EditSession): string[] => [
  ...new Set(
    Object.values(session.reports).flatMap((report) =>
      COLOUR_PROPERTIES.flatMap((property) => {
        const value = report.computed[property];
        return value === undefined || value === "" || alphaPercent(value) === 0 ? [] : [value];
      }),
    ),
  ),
];

const transparent = (value: string | undefined): boolean => value === undefined || value === "" || value === "transparent" || alphaPercent(value) === 0;

export const useColour = (fields: ScreenFields, subjects: readonly ScreenSubject[], property: string) => {
  const [first] = subjects;
  const value = first!.report.computed[property] ?? "";
  const draft = fields.single ? fields.draftOf(first!.id, property) : undefined;
  const fromDraft = draft?.token?.label === undefined ? undefined : fields.scale.colors.find((token) => token.name === draft.token!.label);
  const token = draft !== undefined ? fromDraft : fields.single ? currentColourToken(fields.scale, property, first!.report.className ?? null, first!.report.inline[property] ?? null) : undefined;
  const pickToken = (picked: ScaleToken) => {
    const write = colourWrite(property, picked);
    fields.write(property, () => write.value, write.className === undefined ? undefined : { name: write.className, value: picked.hex ?? picked.resolved, kind: "color", label: picked.name });
  };
  const pickCustom = (hex: string) => fields.write(property, () => hex);
  const alpha = (percent: number) => fields.write(property, (subject) => withAlpha(subject.report.computed[property] ?? "", percent) ?? subject.report.computed[property] ?? "");
  return { value, token, pickToken, pickCustom, alpha, change: fields.changeOf([property]) };
};

export const ColourSection = ({ fields, subjects, onPage }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly onPage: readonly string[] }) => {
  const colour = useColour(fields, subjects, "color");
  return (
    <InspectorSection name="Colour">
      <ColourRow label="Text colour" value={colour.value} token={colour.token} scale={fields.scale} onPage={onPage} change={colour.change} onPickToken={colour.pickToken} onPickCustom={colour.pickCustom} onAlpha={colour.alpha} />
    </InspectorSection>
  );
};

export const FillSection = ({ fields, subjects, onPage }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly onPage: readonly string[] }) => {
  const fill = useColour(fields, subjects, "background-color");
  const empty = transparent(fill.value);
  return (
    <InspectorSection
      name="Fill"
      actions={
        <>
          <ColourPicker
            label="Fill: colour tokens"
            value={empty ? "#FFFFFF" : fill.value}
            token={fill.token}
            scale={fields.scale}
            onPage={onPage}
            onPickToken={fill.pickToken}
            onPickCustom={fill.pickCustom}
            trigger={<Grip aria-hidden />}
          />
          {empty && (
            <Tip label="Add fill">
              <Button variant="ghost" size="icon-xs" aria-label="Add fill" onClick={() => fill.pickCustom("#FFFFFF")}>
                <Plus aria-hidden />
              </Button>
            </Tip>
          )}
        </>
      }
    >
      {!empty && (
        <ColourRow
          label="Fill"
          value={fill.value}
          token={fill.token}
          scale={fields.scale}
          onPage={onPage}
          change={fill.change}
          onPickToken={fill.pickToken}
          onPickCustom={fill.pickCustom}
          onAlpha={fill.alpha}
          actions={
            <Tip label="Remove fill">
              <Button variant="ghost" size="icon-xs" aria-label="Remove fill" onClick={() => fill.pickCustom("transparent")}>
                <Minus aria-hidden />
              </Button>
            </Tip>
          }
        />
      )}
      {empty && fill.change !== undefined && <p className="m-0 text-xs text-(--artifact-editor-note)">{`No fill (was ${hexLabel(fill.change.before) ?? fill.change.before})`}</p>}
    </InspectorSection>
  );
};
