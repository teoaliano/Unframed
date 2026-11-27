import type { ScaleToken } from "@unframed/contracts";
import { blurOf, classForToken, DROP_SHADOW, INNER_SHADOW, shadowLayers, shadowSummary, shadowValue, tokensFor, type ShadowLayer } from "@unframed/domain";
import { Grip, Minus, Plus, Scan, Search, SquareDashed, SquareRoundCorner } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../../chrome/ui.tsx";
import { ColourPicker, ColourRow } from "../../design/colourPicker.tsx";
import { ChangedDot, ScrubField } from "../../design/fields.tsx";
import { IconToggle, InspectorSection, NumberRow, type ScreenFields, type ScreenSubject } from "./ScreenDesign.tsx";
import { useColour } from "./ScreenPaint.tsx";

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
const STYLES = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const SIDE_CHOICES = ["all", "top", "right", "bottom", "left", "custom"] as const;
type SideChoice = (typeof SIDE_CHOICES)[number];

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const BorderSection = ({ fields, subjects, onPage }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly onPage: readonly string[] }) => {
  const [first] = subjects;
  const computed = first!.report.computed;
  const widths = SIDES.map((side) => Number.parseFloat(computed[`border-${side}-width`] ?? "0") || 0);
  const stroked = widths.some((width) => width > 0) && computed["border-style"] !== "none";
  const weight = Math.max(...widths);
  const on = SIDES.filter((_, index) => widths[index]! > 0);
  const sides: SideChoice = on.length === 4 && widths.every((width) => width === weight) ? "all" : on.length === 1 ? on[0]! : "custom";
  const [custom, setCustom] = useState(false);
  const [corners, setCorners] = useState(false);
  const [radiusShown, setRadiusShown] = useState(false);
  const colour = useColour(fields, subjects, "border-color");
  const radius = fields.field("border-radius", "border-radius", (subject) => subject.report.computed["border-top-left-radius"] ?? "");
  const hasRadius = (radius.raw ?? 0) > 0 || radiusShown;
  const border = fields.scale.colors.find((token) => token.group === "Borders");
  const setSides = (choice: SideChoice, width = weight || 1) => {
    if (choice === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    for (const side of SIDES) fields.write(`border-${side}-width`, () => (choice === "all" || choice === side ? `${width}px` : "0px"));
  };
  const addStroke = (token?: ScaleToken) => {
    const picked = token ?? border;
    fields.write("border-style", () => "solid");
    for (const side of SIDES) fields.write(`border-${side}-width`, () => "1px");
    if (picked !== undefined) colour.pickToken(picked);
    else fields.write("border-color", () => "currentcolor");
  };
  return (
    <InspectorSection
      name="Border & radius"
      actions={
        <>
          {!hasRadius && (
            <Tip label="Corner radius">
              <Button variant="ghost" size="icon-xs" aria-label="Corner radius" onClick={() => setRadiusShown(true)}>
                <SquareRoundCorner aria-hidden />
              </Button>
            </Tip>
          )}
          <ColourPicker label="Stroke: colour tokens" value={stroked ? colour.value : (border?.hex ?? colour.value)} token={colour.token} scale={fields.scale} onPage={onPage} trigger={<Grip aria-hidden />} onPickToken={(token) => (stroked ? colour.pickToken(token) : addStroke(token))} onPickCustom={colour.pickCustom} />
          {stroked && (
            <Menu>
              <Tip label="Border sides">
                <MenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Border sides" />}>
                  <SquareDashed aria-hidden />
                </MenuTrigger>
              </Tip>
              <MenuPopup align="end">
                <MenuRadioGroup value={custom ? "custom" : sides} onValueChange={(next) => setSides(next as SideChoice)}>
                  {SIDE_CHOICES.map((choice) => (
                    <MenuRadioItem key={choice} value={choice} closeOnClick>
                      {capital(choice)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          )}
          {!stroked && (
            <Tip label="Add stroke">
              <Button variant="ghost" size="icon-xs" aria-label="Add stroke" onClick={() => addStroke()}>
                <Plus aria-hidden />
              </Button>
            </Tip>
          )}
        </>
      }
    >
      {stroked && (
        <>
          <ColourRow
            label="Stroke"
            value={colour.value}
            token={colour.token}
            scale={fields.scale}
            onPage={onPage}
            change={colour.change}
            onPickToken={colour.pickToken}
            onPickCustom={colour.pickCustom}
            onAlpha={colour.alpha}
            actions={
              <Tip label="Remove stroke">
                <Button variant="ghost" size="icon-xs" aria-label="Remove stroke" onClick={() => SIDES.forEach((side) => fields.write(`border-${side}-width`, () => "0px"))}>
                  <Minus aria-hidden />
                </Button>
              </Tip>
            }
          />
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <ChangedDot change={fields.changeOf(["border-style"])} />
              <Select value={computed["border-style"] ?? "solid"} onValueChange={(next) => next !== null && fields.write("border-style", () => String(next))}>
                <SelectTrigger aria-label="Stroke style" size="sm">
                  <SelectValue>{STYLES.find((style) => style.value === computed["border-style"])?.label ?? computed["border-style"]}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {STYLES.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {!custom && (
              <ScrubField
                label="Stroke weight"
                shown={sides === "all" ? String(weight) : `${weight} · ${sides}`}
                raw={weight}
                icon={<span className="text-xs">≡</span>}
                bounds={{ min: 0 }}
                change={fields.changeOf(SIDES.map((side) => `border-${side}-width`))}
                onCommit={(typed) => setSides(sides === "custom" ? "all" : sides, typed)}
              />
            )}
          </div>
          {custom && (
            <div className="grid grid-cols-2 gap-1.5">
              {SIDES.map((side: Side) => (
                <NumberRow key={side} fields={fields} label={`Border ${side} width`} field={fields.field(`border-${side}-width`)} icon={<span className="text-xs">{side.charAt(0).toUpperCase()}</span>} />
              ))}
            </div>
          )}
        </>
      )}
      {hasRadius && (
        <div className="flex min-w-0 items-center gap-1">
          {corners ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
              {CORNERS.map((corner) => (
                <NumberRow key={corner} fields={fields} label={`${capital(corner.replace("-", " "))} radius`} field={fields.field(`border-${corner}-radius`)} icon={<span className="text-xs">◜</span>} />
              ))}
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <NumberRow fields={fields} label="Corner radius" field={radius} icon={<SquareRoundCorner aria-hidden className="size-3" />} />
            </div>
          )}
          <IconToggle label="Individual corners" pressed={corners} onPressedChange={setCorners}>
            <Scan aria-hidden />
          </IconToggle>
        </div>
      )}
    </InspectorSection>
  );
};

const ShadowTokens = ({ fields, onPick }: { readonly fields: ScreenFields; readonly onPick: (token: ScaleToken) => void }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tokens = tokensFor(fields.scale, "box-shadow").filter((token) => token.name.includes(query.trim().toLowerCase()));
  const groups = [
    { name: "Shadows", tokens: tokens.filter((token) => token.origin !== "custom") },
    { name: "Other shadows", tokens: tokens.filter((token) => token.origin === "custom") },
  ].filter((group) => group.tokens.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Shadow tokens">
        <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Shadow tokens" />}>
          <Grip aria-hidden />
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="left" align="start" padding="compact" className="w-72" aria-label="Shadow tokens">
        <PopoverTitle>Shadow tokens</PopoverTitle>
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput aria-label="Search tokens" placeholder="Search tokens" size="sm" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        </InputGroup>
        <div role="listbox" aria-label="Shadow tokens" className="mt-1.5 flex max-h-72 flex-col gap-0.5 overflow-auto">
          {groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name} className="flex flex-col">
              <span className="px-2 py-1 text-xs font-medium text-(--design-panel-label)">{group.name}</span>
              {group.tokens.map((token) => (
                <Button
                  key={token.name}
                  role="option"
                  aria-selected={false}
                  aria-label={token.name}
                  variant="ghost"
                  size="sm"
                  className="min-w-0 justify-start"
                  onClick={() => {
                    setOpen(false);
                    onPick(token);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-xs">{token.name}</span>
                  <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{shadowSummary(token)}</span>
                </Button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="m-0 px-2 py-1 text-xs text-(--artifact-editor-note)">No shadow tokens found in this project.</p>}
        </div>
      </PopoverPopup>
    </Popover>
  );
};

const LAYER_PARTS = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "blur", label: "Blur" },
  { key: "spread", label: "Spread" },
] as const;

export const ShadowSection = ({ fields, subjects, onPage }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly onPage: readonly string[] }) => {
  const [first] = subjects;
  const computed = first!.report.computed;
  const layers = shadowLayers(computed["box-shadow"]);
  const blur = blurOf(computed.filter);
  const backdrop = blurOf(computed["backdrop-filter"]);
  const writeLayers = (next: readonly ShadowLayer[]) => fields.write("box-shadow", () => shadowValue(next));
  const shadowVars = (token: ScaleToken) => ({ value: token.variable === null ? token.resolved : `var(${token.variable})`, name: classForToken("box-shadow", token) });
  const pickToken = (token: ScaleToken) => {
    const write = shadowVars(token);
    fields.write("box-shadow", () => write.value, write.name === undefined ? undefined : { name: write.name, value: token.resolved, kind: "shadow", label: token.name });
  };
  return (
    <InspectorSection
      name="Shadow"
      actions={
        <>
          <ShadowTokens fields={fields} onPick={pickToken} />
          <Menu>
            <Tip label="Add effect">
              <MenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Add effect" />}>
                <Plus aria-hidden />
              </MenuTrigger>
            </Tip>
            <MenuPopup align="end" className="min-w-40">
              <MenuItem onClick={() => writeLayers([...layers, DROP_SHADOW])}>Drop shadow</MenuItem>
              <MenuItem onClick={() => writeLayers([...layers, INNER_SHADOW])}>Inner shadow</MenuItem>
              <MenuItem onClick={() => fields.write("filter", () => "blur(4px)")}>Layer blur</MenuItem>
              <MenuItem onClick={() => fields.write("backdrop-filter", () => "blur(4px)")}>Background blur</MenuItem>
            </MenuPopup>
          </Menu>
        </>
      }
    >
      {layers.map((layer, index) => (
        <div key={index} role="group" aria-label={`${layer.inset ? "Inner shadow" : "Drop shadow"} ${index + 1}`} className="flex flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <ChangedDot change={index === 0 ? fields.changeOf(["box-shadow"]) : undefined} />
            <span className="min-w-0 flex-1 truncate text-xs">{layer.inset ? "Inner shadow" : "Drop shadow"}</span>
            <Tip label="Remove effect">
              <Button variant="ghost" size="icon-xs" aria-label="Remove effect" onClick={() => writeLayers(layers.filter((_, at) => at !== index))}>
                <Minus aria-hidden />
              </Button>
            </Tip>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {LAYER_PARTS.map((part) => (
              <ScrubField
                key={part.key}
                label={`Shadow ${part.label.toLowerCase()}`}
                shown={String(layer[part.key])}
                raw={layer[part.key]}
                icon={<span className="text-xs">{part.label.charAt(0)}</span>}
                bounds={part.key === "blur" ? { min: 0 } : {}}
                onCommit={(typed) => writeLayers(layers.map((each, at) => (at === index ? { ...each, [part.key]: typed } : each)))}
              />
            ))}
          </div>
          <ColourPicker
            label="Shadow colour"
            value={layer.colour}
            token={undefined}
            scale={fields.scale}
            onPage={onPage}
            trigger={<span className="truncate font-mono text-xs">{layer.colour}</span>}
            onPickToken={(token) => writeLayers(layers.map((each, at) => (at === index ? { ...each, colour: token.variable === null ? token.resolved : `var(${token.variable})` } : each)))}
            onPickCustom={(hex) => writeLayers(layers.map((each, at) => (at === index ? { ...each, colour: hex } : each)))}
          />
        </div>
      ))}
      {blur !== undefined && (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <NumberRow fields={fields} label="Layer blur" field={{ ...fields.field("filter"), shown: String(blur), raw: blur, bound: undefined }} icon={<span className="text-xs">◌</span>} onCommit={(typed) => fields.write("filter", () => `blur(${typed}px)`)} />
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Remove layer blur" onClick={() => fields.write("filter", () => "none")}>
            <Minus aria-hidden />
          </Button>
        </div>
      )}
      {backdrop !== undefined && (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <NumberRow fields={fields} label="Background blur" field={{ ...fields.field("backdrop-filter"), shown: String(backdrop), raw: backdrop, bound: undefined }} icon={<span className="text-xs">◌</span>} onCommit={(typed) => fields.write("backdrop-filter", () => `blur(${typed}px)`)} />
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Remove background blur" onClick={() => fields.write("backdrop-filter", () => "none")}>
            <Minus aria-hidden />
          </Button>
        </div>
      )}
    </InspectorSection>
  );
};
