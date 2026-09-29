/**
 * The kit menu's popup and row look (spec 12), for listboxes the kit's Menu cannot host:
 * the mention, slash and chat search menus, whose text field keeps the keyboard while
 * they are open. A row shows as highlighted while it carries `data-highlighted`.
 */
export const listboxPopupClass = "dropdown-glass box-border overflow-y-auto rounded-lg p-1 font-sans text-foreground shadow-lg/5";

export const listboxRowClass =
  "flex min-h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";
