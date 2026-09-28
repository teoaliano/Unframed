import { Menu } from "@base-ui/react/menu";
import { addablePropValue, modelPart, type ModelParams } from "@unframed/domain";
import { Check } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { itemClass, popupClass, Tip } from "../../chrome/ui.tsx";
import type { PropValue, TrayPropDefinition, TrayProps } from "../mediumRegistry.ts";

export interface PropTrayProps {
  readonly model: string | undefined;
  readonly catalogueReady: boolean;
  readonly params: ModelParams;
  /** Props the model does not drive, after the model's own. */
  readonly extra?: ReadonlyArray<TrayPropDefinition> | undefined;
  readonly props: TrayProps;
  readonly onModelClick: () => void;
  readonly onChange: (props: Record<string, PropValue>) => void;
  /** Whether one of the tray's menus is open, so the shell leaves Esc to it. */
  readonly onMenuOpen: (open: boolean) => void;
}

const chipClass =
  "cursor-pointer rounded-inner border-0 bg-transparent px-1 py-0.5 text-[12.5px] text-primary hover:bg-hover data-[popup-open]:bg-hover disabled:cursor-default disabled:text-secondary";

/**
 * The tray below the box: the model chip, one chip per prop that will be sent, and
 * "+ add prop". A prop comes off the way it went on: from its own menu.
 */
export const PropTray = ({ model, catalogueReady, params, extra = [], props, onModelClick, onChange, onMenuOpen }: PropTrayProps) => {
  const [openProp, setOpenProp] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const inTray = params.props.filter((prop) => props[prop.key] !== undefined);
  const addable = params.props.filter((prop) => props[prop.key] === undefined);
  const extraInTray = extra.filter((prop) => prop.inTray(props) || openProp === prop.key);
  const extraAddable = extra.filter((prop) => !prop.inTray(props) && openProp !== prop.key);

  // One flag for all of the tray's menus: a value menu can open as the add menu closes.
  const anyOpen = openProp !== undefined || addOpen;
  useEffect(() => onMenuOpen(anyOpen), [anyOpen, onMenuOpen]);
  const setOpen = (key: string | undefined) => setOpenProp(key);

  return (
    <div className="unframed-composer-tray" data-testid="composer-tray">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <Tip label={model ?? "Loading models…"} side="top">
          <button type="button" className={chipClass} data-testid="model-chip" disabled={!catalogueReady} onClick={onModelClick}>
            {catalogueReady && model !== undefined ? modelPart(model) : "Loading models…"}
          </button>
        </Tip>
        {inTray.map((prop) => (
          <Fragment key={prop.key}>
            <span aria-hidden className="text-[12.5px] text-[var(--unframed-border-emphasized)]">
              ·
            </span>
            <Menu.Root open={openProp === prop.key} onOpenChange={(open) => setOpen(open ? prop.key : undefined)}>
              <Menu.Trigger className={chipClass} data-prop={prop.key} aria-label={`${prop.label} ${String(props[prop.key])}`}>
                {String(props[prop.key])}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="top" align="start" sideOffset={6} className="z-[1250]">
                  <Menu.Popup className={`${popupClass} min-w-[160px]`} aria-label={prop.label}>
                    <Menu.RadioGroup value={String(props[prop.key])} onValueChange={(value: string) => onChange({ ...props, [prop.key]: value })}>
                      {prop.values.map((value) => (
                        <Menu.RadioItem key={value} value={value} className={itemClass} closeOnClick>
                          <span className="flex size-4 items-center justify-center">
                            <Menu.RadioItemIndicator>
                              <Check size={14} aria-hidden />
                            </Menu.RadioItemIndicator>
                          </span>
                          {prop.optionLabels?.[value] ?? value}
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                    <Menu.Separator className="my-1 h-px bg-[var(--unframed-border)]" />
                    <Menu.Item
                      className={itemClass}
                      onClick={() => {
                        const { [prop.key]: _removed, ...rest } = props;
                        onChange(rest);
                      }}
                    >
                      <span className="size-4" />
                      Remove
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </Fragment>
        ))}
        {extraInTray.map((prop) => (
          <Fragment key={prop.key}>
            <span aria-hidden className="text-[12.5px] text-[var(--unframed-border-emphasized)]">
              ·
            </span>
            <prop.Chip props={props} onChange={onChange} open={openProp === prop.key} onOpenChange={(open) => setOpen(open ? prop.key : undefined)} />
          </Fragment>
        ))}
      </div>
      {addable.length + extraAddable.length > 0 && (
        <Menu.Root
          open={addOpen}
          onOpenChange={setAddOpen}
        >
          <Menu.Trigger className={`${chipClass} shrink-0 text-secondary`}>+ add prop</Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="end" sideOffset={6} className="z-[1250]">
              <Menu.Popup className={`${popupClass} min-w-[186px]`} aria-label="Add prop">
                {addable.map((prop) => {
                  const value = addablePropValue(params, prop.key, props) ?? "";
                  return (
                    <Menu.Item
                      key={prop.key}
                      aria-label={`${prop.label} ${value}`}
                      className={`${itemClass} justify-between`}
                      onClick={() => {
                        onChange({ ...props, [prop.key]: value });
                        // The new chip opens its value menu once it is on screen.
                        requestAnimationFrame(() => setOpen(prop.key));
                      }}
                    >
                      <span>{prop.label}</span>
                      <span className="text-secondary">{value}</span>
                    </Menu.Item>
                  );
                })}
                {extraAddable.map((prop) => {
                  const value = prop.addValue(props);
                  return (
                    <Menu.Item
                      key={prop.key}
                      aria-label={`${prop.label} ${value}`}
                      className={`${itemClass} justify-between`}
                      onClick={() => {
                        onChange(prop.add(props));
                        requestAnimationFrame(() => setOpen(prop.key));
                      }}
                    >
                      <span>{prop.label}</span>
                      <span className="text-secondary">{value}</span>
                    </Menu.Item>
                  );
                })}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
};
