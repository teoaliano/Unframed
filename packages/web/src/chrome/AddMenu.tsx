import { Menu } from "@base-ui/react/menu";
import { Plus } from "lucide-react";
import { useEditor } from "tldraw";
import { addShape, kindOfAddAction, viewportCentre } from "../canvas/addShapes.ts";
import { ADD_ICONS, ADD_SECTIONS } from "./addItems.tsx";
import { useSlots } from "./slots.ts";
import { itemClass, popupClass, sectionHeadingClass } from "./ui.tsx";

/**
 * The bottom-right corner: the Library button slot and the add menu. It sits above tldraw's
 * watermark, never over it.
 */
export const BottomRight = () => {
  const editor = useEditor();
  const { libraryButton: Library } = useSlots();
  return (
    <div className="unframed-chrome-bottom-right">
      {Library && <Library />}
      <Menu.Root>
        <Menu.Trigger
          aria-label="Add"
          className="flex size-12 cursor-pointer items-center justify-center rounded-xl border-0 bg-primary p-0 text-primary-foreground shadow-lg hover:bg-[color-mix(in_srgb,var(--unframed-accent)_88%,var(--unframed-on-accent))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus size={22} aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="inline-start" align="end" sideOffset={8} className="z-[800]">
            {/* A new prompt keeps the keyboard: focus does not go back to the button. */}
            <Menu.Popup className={`${popupClass} w-[152px] min-w-0`} finalFocus={() => editor.getEditingShapeId() === null}>
              {ADD_SECTIONS.map((section) => (
                <Menu.Group key={section.heading}>
                  <Menu.GroupLabel className={sectionHeadingClass}>{section.heading}</Menu.GroupLabel>
                  {section.items.map((item) => {
                    const Icon = ADD_ICONS[item.action];
                    return (
                      <Menu.Item
                        key={item.action}
                        className={itemClass}
                        onClick={() => addShape(editor, kindOfAddAction(item.action), { centre: viewportCentre(editor) })}
                      >
                        <Icon size={16} aria-hidden />
                        {item.label}
                      </Menu.Item>
                    );
                  })}
                </Menu.Group>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};
