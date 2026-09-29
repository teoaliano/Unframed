import { useRef, useState } from "react";
import { TldrawUiButtonIcon, TldrawUiToolbar, TldrawUiToolbarButton, useEditor } from "tldraw";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup } from "~/components/ui/menu";
import { addShape, kindOfAddAction, viewportCentre } from "../canvas/addShapes.ts";
import { ADD_ICONS, ADD_SECTIONS } from "./addItems.tsx";
import { useSlots } from "./slots.ts";

/**
 * The end of the bottom bar: the Agent and Library slots and Add, as tldraw toolbar buttons beside
 * tldraw's tools. Add opens the kit menu above it.
 */
export const ToolbarEnd = () => {
  const editor = useEditor();
  const { agentButton: Agent, libraryButton: Library } = useSlots();
  const [open, setOpen] = useState(false);
  const add = useRef<HTMLButtonElement>(null);
  return (
    <TldrawUiToolbar orientation="horizontal" label="Unframed" data-unframed-toolbar-group="">
      {Agent && <Agent />}
      {Library && <Library />}
      <TldrawUiToolbarButton ref={add} type="tool" title="Add" isActive={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <TldrawUiButtonIcon icon="plus" />
      </TldrawUiToolbarButton>
      <Menu open={open} onOpenChange={setOpen}>
        {/* A new prompt keeps the keyboard: focus does not go back to the button. */}
        <MenuPopup anchor={add} side="top" align="end" sideOffset={8} className="w-[152px] min-w-0" finalFocus={() => editor.getEditingShapeId() === null}>
          {ADD_SECTIONS.map((section) => (
            <MenuGroup key={section.heading}>
              <MenuGroupLabel>{section.heading}</MenuGroupLabel>
              {section.items.map((item) => {
                const Icon = ADD_ICONS[item.action];
                return (
                  <MenuItem key={item.action} onClick={() => addShape(editor, kindOfAddAction(item.action), { centre: viewportCentre(editor) })}>
                    <Icon aria-hidden />
                    {item.label}
                  </MenuItem>
                );
              })}
            </MenuGroup>
          ))}
        </MenuPopup>
      </Menu>
    </TldrawUiToolbar>
  );
};
