import { addablePropValue, modelPart, type ModelParams } from "@unframed/domain";
import { useLayoutEffect, useState, type ComponentProps } from "react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tip } from "../../chrome/ui.tsx";
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
  /** The value "+ add prop" offers a prop with; the image rule when absent. */
  readonly addable?: ((params: ModelParams, key: string, props: TrayProps) => PropValue | undefined) | undefined;
  /** Whether one of the tray's menus is open, and how the shell closes them on Esc. */
  readonly onMenuOpen: (open: boolean, close: () => void) => void;
}

/** The tray's one chip recipe (spec 12): the model chip, each prop chip and the Runs chip. */
export const TrayChip = (props: ComponentProps<typeof Button>) => <Button variant="outline" size="compact" {...props} />;

/**
 * The tray below the box: the model chip, one chip per prop that will be sent, and
 * "+ add prop". A prop comes off the way it went on: from its own menu.
 */
export const PropTray = ({ model, catalogueReady, params, extra = [], props, onModelClick, onChange, onMenuOpen, addable: addableValue }: PropTrayProps) => {
  const [openProp, setOpenProp] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const inTray = params.props.filter((prop) => props[prop.key] !== undefined);
  const addable = params.props.filter((prop) => props[prop.key] === undefined);
  const extraInTray = extra.filter((prop) => prop.inTray(props) || openProp === prop.key);
  const extraAddable = extra.filter((prop) => !prop.inTray(props) && openProp !== prop.key);

  // One flag for all of the tray's menus: a value menu can open as the add menu closes.
  // Reported in the render that shows the menu, so an Esc right after it finds the flag set.
  const anyOpen = openProp !== undefined || addOpen;
  useLayoutEffect(
    () =>
      onMenuOpen(anyOpen, () => {
        setOpenProp(undefined);
        setAddOpen(false);
      }),
    [anyOpen, onMenuOpen],
  );
  const setOpen = (key: string | undefined) => setOpenProp(key);

  return (
    <div className="flex items-center justify-between gap-2 px-0.5 pt-0.5" data-testid="composer-tray">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Tip label={model ?? "Loading models…"} side="top">
          <TrayChip data-testid="model-chip" disabled={!catalogueReady} onClick={onModelClick}>
            {catalogueReady && model !== undefined ? modelPart(model) : "Loading models…"}
          </TrayChip>
        </Tip>
        {inTray.map((prop) => (
          <Menu key={prop.key} open={openProp === prop.key} onOpenChange={(open) => setOpen(open ? prop.key : undefined)}>
            <MenuTrigger data-prop={prop.key} aria-label={`${prop.label} ${String(props[prop.key])}`} render={<TrayChip />}>
              {prop.chipLabels?.[String(props[prop.key])] ?? String(props[prop.key])}
            </MenuTrigger>
            <MenuPopup side="top" align="start" sideOffset={6} aria-label={prop.label}>
              {prop.checkbox ? (
                <MenuCheckboxItem checked={props[prop.key] === true} onCheckedChange={(checked: boolean) => onChange({ ...props, [prop.key]: checked })} closeOnClick>
                  {prop.label}
                </MenuCheckboxItem>
              ) : (
                <MenuRadioGroup value={String(props[prop.key])} onValueChange={(value: string) => onChange({ ...props, [prop.key]: value })}>
                  {prop.values.map((value) => (
                    <MenuRadioItem key={value} value={value} closeOnClick>
                      <span className="flex items-center justify-between gap-3">
                        {prop.optionLabels?.[value] ?? value}
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              )}
              {!prop.required && <MenuSeparator />}
              {!prop.required && (
                <MenuItem
                  onClick={() => {
                    const { [prop.key]: _removed, ...rest } = props;
                    onChange(rest);
                  }}
                >
                  Remove
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        ))}
        {extraInTray.map((prop) => (
          <prop.Chip key={prop.key} props={props} onChange={onChange} open={openProp === prop.key} onOpenChange={(open) => setOpen(open ? prop.key : undefined)} />
        ))}
      </div>
      {addable.length + extraAddable.length > 0 && (
        <Menu open={addOpen} onOpenChange={setAddOpen}>
          <MenuTrigger render={<Button variant="ghost-muted" size="compact" />}>+ add prop</MenuTrigger>
          <MenuPopup side="top" align="end" sideOffset={6} aria-label="Add prop" className="min-w-[186px]">
            {addable.map((prop) => {
              const value = (addableValue ? addableValue(params, prop.key, props) : addablePropValue(params, prop.key, props)) ?? "";
              const shown = prop.optionLabels?.[String(value)] ?? String(value);
              return (
                <MenuItem
                  key={prop.key}
                  aria-label={`${prop.label} ${shown}`}
                  className="justify-between"
                  onClick={() => {
                    onChange({ ...props, [prop.key]: value });
                    // The new chip opens its value menu once it is on screen.
                    requestAnimationFrame(() => setOpen(prop.key));
                  }}
                >
                  <span>{prop.label}</span>
                  <span className="text-muted-foreground">{shown}</span>
                </MenuItem>
              );
            })}
            {extraAddable.map((prop) => {
              const value = prop.addValue(props);
              return (
                <MenuItem
                  key={prop.key}
                  aria-label={`${prop.label} ${value}`}
                  className="justify-between"
                  onClick={() => {
                    onChange(prop.add(props));
                    requestAnimationFrame(() => setOpen(prop.key));
                  }}
                >
                  <span>{prop.label}</span>
                  <span className="text-muted-foreground">{value}</span>
                </MenuItem>
              );
            })}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
};
