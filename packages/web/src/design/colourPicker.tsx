import type { ScaleToken, TokenScale } from "@unframed/contracts";
import { colourGroups, hexAndAlpha, hexOfHsva, hsvaOf, sameColourToken, type Hsva } from "@unframed/domain";
import { Check, Pipette, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/ui/tabs";
import { Tip } from "../chrome/ui.tsx";
import { ChangedDot, ScrubField, type FieldChange } from "./fields.tsx";
import { Swatch } from "./controls.tsx";

const middle = (name: string, most = 22): string => (name.length <= most ? name : `${name.slice(0, Math.ceil(most / 2) - 1)}…${name.slice(-Math.floor(most / 2))}`);

const hexText = (token: ScaleToken): string => {
  const { hex, alpha } = hexAndAlpha(token.hex ?? token.resolved);
  return alpha < 100 ? `${hex} ${alpha}%` : hex;
};

const Area = ({ label, value, onChange, children, className }: { readonly label: string; readonly value: { readonly x: number; readonly y?: number }; readonly onChange: (x: number, y: number) => void; readonly children?: ReactNode; readonly className: string }) => {
  const held = useRef(false);
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onChange(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const y = value.y ?? 0;
    if (event.key === "ArrowLeft") onChange(Math.max(0, value.x - step), y);
    else if (event.key === "ArrowRight") onChange(Math.min(1, value.x + step), y);
    else if (event.key === "ArrowUp" && value.y !== undefined) onChange(value.x, Math.max(0, y - step));
    else if (event.key === "ArrowDown" && value.y !== undefined) onChange(value.x, Math.min(1, y + step));
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value.x * 100)}
      tabIndex={0}
      className={`relative cursor-crosshair touch-none rounded-md ${className}`}
      onPointerDown={(event) => {
        held.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        at(event);
      }}
      onPointerMove={(event) => held.current && at(event)}
      onPointerUp={() => {
        held.current = false;
      }}
      onKeyDown={keys}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--design-panel-surface) shadow-sm"
        style={{ left: `${value.x * 100}%`, top: value.y === undefined ? "50%" : `${value.y * 100}%` }}
      />
    </div>
  );
};

const CustomTab = ({ value, scale, onPage, onPick }: { readonly value: string; readonly scale: TokenScale; readonly onPage: readonly string[]; readonly onPick: (hex: string) => void }) => {
  const [colour, setColour] = useState<Hsva>(() => hsvaOf(value) ?? { h: 0, s: 0, v: 0, a: 1 });
  useEffect(() => {
    const next = hsvaOf(value);
    if (next !== undefined && hexOfHsva(next) !== hexOfHsva(colour)) setColour((previous) => ({ ...next, h: next.s === 0 ? previous.h : next.h }));
  }, [value]);
  const set = (next: Hsva) => {
    setColour(next);
    onPick(hexOfHsva(next));
  };
  const hex = hexOfHsva({ ...colour, a: 1 });
  const [typed, setTyped] = useState(hex.slice(1));
  useEffect(() => setTyped(hex.slice(1)), [hex]);
  const same = sameColourToken(scale, hexOfHsva(colour));
  const swatches = [...new Set(onPage.map((each) => hexAndAlpha(each).hex).filter((each) => each !== ""))].slice(0, 16);
  const eyedropper = typeof window !== "undefined" && "EyeDropper" in window;
  return (
    <div className="flex flex-col gap-2">
      <Area
        label="Saturation and brightness"
        value={{ x: colour.s, y: 1 - colour.v }}
        onChange={(x, y) => set({ ...colour, s: x, v: 1 - y })}
        className="h-36 w-full"
      >
        <span aria-hidden className="absolute inset-0 rounded-md" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hexOfHsva({ h: colour.h, s: 1, v: 1, a: 1 })})` }} />
      </Area>
      <div className="flex items-center gap-2">
        {eyedropper && (
          <Tip label="Pick a colour from the screen">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Pick a colour from the screen"
              onClick={() => {
                const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
                void new Dropper().open().then(
                  (picked) => {
                    const next = hsvaOf(picked.sRGBHex);
                    if (next !== undefined) set({ ...next, a: colour.a });
                  },
                  () => undefined,
                );
              }}
            >
              <Pipette aria-hidden />
            </Button>
          </Tip>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Area label="Hue" value={{ x: colour.h / 360 }} onChange={(x) => set({ ...colour, h: Math.min(359.99, x * 360) })} className="h-3 w-full">
            <span aria-hidden className="absolute inset-0 rounded-md" style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }} />
          </Area>
          <Area label="Alpha" value={{ x: colour.a }} onChange={(x) => set({ ...colour, a: Math.round(x * 100) / 100 })} className="h-3 w-full">
            <span aria-hidden className="absolute inset-0 rounded-md" style={{ background: `linear-gradient(to right, transparent, ${hex})` }} />
          </Area>
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_4rem] items-center gap-1.5">
        <span className="px-1 text-xs text-(--design-panel-label)">Hex</span>
        <Input
          aria-label="Hex"
          size="sm"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const next = hsvaOf(`#${typed.replace(/^#/, "")}`);
            if (next !== undefined) set({ ...next, a: next.a < 1 ? next.a : colour.a });
          }}
          onBlur={() => {
            const next = hsvaOf(`#${typed.replace(/^#/, "")}`);
            if (next !== undefined && hexOfHsva({ ...next, a: 1 }) !== hex) set({ ...next, a: colour.a });
          }}
        />
        <ScrubField label="Colour opacity" shown={`${Math.round(colour.a * 100)}%`} raw={Math.round(colour.a * 100)} icon={null} bounds={{ min: 0, max: 100 }} onCommit={(typed) => set({ ...colour, a: Math.min(100, Math.max(0, typed)) / 100 })} />
      </div>
      {same !== undefined && (
        <p className="m-0 flex min-w-0 items-center gap-1 text-xs text-(--artifact-editor-meta)" data-testid="colour-same-as">
          <span className="truncate">{`Same as ${same.name}`}</span>
        </p>
      )}
      {swatches.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-(--design-panel-label)">On this page</span>
          <div className="flex flex-wrap gap-1">
            {swatches.map((each) => (
              <Button key={each} variant="ghost" size="icon-xs" aria-label={`#${each}`} onClick={() => set({ ...hsvaOf(`#${each}`)!, a: colour.a })}>
                <Swatch colour={`#${each}`} />
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const TokenRow = ({ token, current, onPick }: { readonly token: ScaleToken; readonly current: boolean; readonly onPick: () => void }) => (
  <Button role="option" aria-selected={current} aria-label={token.name} variant="ghost" size="sm" className="min-w-0 justify-start" onClick={onPick}>
    <Swatch colour={token.hex ?? token.resolved} />
    <span className="min-w-0 flex-1 truncate text-left text-xs" title={token.name}>
      {middle(token.name)}
    </span>
    <span className="shrink-0 font-mono text-xs text-(--artifact-editor-meta)">{hexText(token)}</span>
    {current && <Check aria-hidden className="size-3.5" />}
  </Button>
);

const TokensTab = ({ scale, current, onPage, onPick }: { readonly scale: TokenScale; readonly current: ScaleToken | undefined; readonly onPage: readonly string[]; readonly onPick: (token: ScaleToken) => void }) => {
  const [query, setQuery] = useState("");
  const groups = colourGroups(scale, query, onPage);
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput aria-label="Search name, hex or class" placeholder="Search name, hex or class" size="sm" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </InputGroup>
      <div role="listbox" aria-label="Colour tokens" className="flex max-h-80 flex-col gap-0.5 overflow-auto">
        {current !== undefined && query.trim() === "" && (
          <div role="group" aria-label="Current" className="flex flex-col">
            <span className="px-2 py-1 text-xs font-medium text-(--design-panel-label)">Current</span>
            <TokenRow token={current} current onPick={() => onPick(current)} />
            {current.chain.length > 1 && <span className="truncate px-2 pb-1 text-xs text-(--artifact-editor-meta)">{current.chain.slice(1).map((name) => `→ ${name.slice(2)}`).join(" ")}</span>}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.name} role="group" aria-label={group.name} className="flex flex-col">
            <span className="flex items-center justify-between px-2 py-1 text-xs font-medium text-(--design-panel-label)">
              <span>{group.name}</span>
              <span className="text-(--artifact-editor-meta)">{group.count}</span>
            </span>
            {group.tokens.map((token) => (
              <TokenRow key={token.name} token={token} current={token.name === current?.name} onPick={() => onPick(token)} />
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="m-0 px-2 py-1 text-xs text-(--artifact-editor-note)">{scale.colors.length === 0 ? "No colour tokens found in this project." : "No colour matches."}</p>}
      </div>
    </div>
  );
};

export const ColourPicker = ({
  label,
  value,
  token,
  scale,
  onPage,
  trigger,
  onPickToken,
  onPickCustom,
}: {
  readonly label: string;
  readonly value: string;
  readonly token: ScaleToken | undefined;
  readonly scale: TokenScale;
  readonly onPage: readonly string[];
  readonly trigger: ReactNode;
  readonly onPickToken: (token: ScaleToken) => void;
  readonly onPickCustom: (hex: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [chosen, setTab] = useState<string | null>(null);
  const tab = chosen ?? (scale.colors.length > 0 ? "tokens" : "custom");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTab(null);
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" aria-label={label} />}>{trigger}</PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-72" aria-label={`${label} picker`}>
        <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
          <div className="flex items-center gap-1">
            <TabsList aria-label="Colour source">
              <TabsTab value="tokens">Tokens</TabsTab>
              <TabsTab value="custom">Custom</TabsTab>
            </TabsList>
            <PopoverClose render={<Button variant="ghost" size="icon-xs" aria-label="Close" className="ml-auto" />}>
              <X aria-hidden />
            </PopoverClose>
          </div>
          <TabsPanel value="tokens">
            <TokensTab
              scale={scale}
              current={token}
              onPage={onPage}
              onPick={(picked) => {
                setOpen(false);
                onPickToken(picked);
              }}
            />
          </TabsPanel>
          <TabsPanel value="custom">
            <CustomTab value={value} scale={scale} onPage={onPage} onPick={onPickCustom} />
          </TabsPanel>
        </Tabs>
      </PopoverPopup>
    </Popover>
  );
};

export const ColourRow = ({
  label,
  value,
  token,
  scale,
  onPage,
  change,
  actions,
  onPickToken,
  onPickCustom,
  onAlpha,
}: {
  readonly label: string;
  readonly value: string;
  readonly token: ScaleToken | undefined;
  readonly scale: TokenScale;
  readonly onPage: readonly string[];
  readonly change: FieldChange | undefined;
  readonly actions?: ReactNode;
  readonly onPickToken: (token: ScaleToken) => void;
  readonly onPickCustom: (hex: string) => void;
  readonly onAlpha: (percent: number) => void;
}) => {
  const { hex, alpha } = hexAndAlpha(value);
  const name = token?.name ?? (hex === "" ? value : hex);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <ChangedDot change={change} />
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_5rem] items-center gap-1">
        <ColourPicker
          label={label}
          value={value}
          token={token}
          scale={scale}
          onPage={onPage}
          onPickToken={onPickToken}
          onPickCustom={onPickCustom}
          trigger={
            <>
              <Swatch colour={value} />
              <span className="min-w-0 truncate text-xs" title={token === undefined || hex === "" ? name : `${name} ${hex}`}>
                {middle(name, 18)}
              </span>
            </>
          }
        />
        <ScrubField label={`${label} opacity`} shown={`${alpha}%`} raw={alpha} icon={null} bounds={{ min: 0, max: 100 }} onCommit={onAlpha} />
      </div>
      {actions}
    </div>
  );
};
