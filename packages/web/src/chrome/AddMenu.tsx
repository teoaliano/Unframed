import { Plus } from "lucide-react";
import { useEditor } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { addShape, kindOfAddAction, viewportCentre } from "../canvas/addShapes.ts";
import { ADD_ICONS, ADD_SECTIONS } from "./addItems.tsx";
import { useSlots } from "./slots.ts";
import { cornerCardClass } from "./ui.tsx";

/**
 * The bottom-right corner: the Library button slot and the add menu. It sits above tldraw's
 * watermark, never over it.
 */
export const BottomRight = () => {
  const editor = useEditor();
  const { libraryButton: Library } = useSlots();
  return (
    // 56 px up clears tldraw's watermark (8 px from the corner, 36 px tall), which stays uncovered.
    <div className={`pointer-events-auto absolute right-3 bottom-14 z-[300] ${cornerCardClass} flex-col`} data-testid="chrome-bottom-right">
      {Library && <Library />}
      <Menu>
        <MenuTrigger aria-label="Add" render={<Button size="icon-lg" />}>
          <Plus aria-hidden />
        </MenuTrigger>
        {/* A new prompt keeps the keyboard: focus does not go back to the button. */}
        <MenuPopup side="inline-start" align="end" sideOffset={8} className="w-[152px] min-w-0" finalFocus={() => editor.getEditingShapeId() === null}>
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
    </div>
  );
};
