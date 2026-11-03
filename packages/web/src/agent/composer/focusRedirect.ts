/**
 * Type-to-focus and paste-to-focus in the rail (t3code's `composerFocusRedirect`): a key or a
 * paste whose target is inside the rail but on nothing that takes typing goes to the composer.
 * The listener sits on the rail, so a key on the canvas, where tldraw owns the keys, never
 * reaches it.
 */

const EDITABLE = ["input", "textarea", "select", '[contenteditable="true"]', '[contenteditable="plaintext-only"]', '[role="textbox"]'].join(",");

const INTERACTIVE = [
  "button",
  "a[href]",
  "summary",
  '[role="application"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(",");

// Closed popups can stay mounted; match only open or closing layers.
const FLOATING_LAYER = [
  '[role="dialog"][aria-modal="true"]',
  '[data-slot="alert-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="command-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sheet-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="menu-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="select-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="popover-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="combobox-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="autocomplete-popup"]:is([data-open],[data-ending-style])',
].join(",");

/**
 * A chat tab in the rail's strip: unlike t3code's tabs it has no keys of its own but Space
 * and Enter, so the rest of the printable keys type into the composer.
 */
const CHAT_TAB = "[data-testid='chat-tabs'] [role='tab'][data-chat-id]";

const pathHas = (event: Event, selector: string): boolean => {
  const path = event.composedPath();
  if (path.length === 0 && event.target) path.push(event.target);
  return path.some((target) => target instanceof Element && target.closest(selector) !== null);
};

const redirectable = (event: Event, rail: Element): boolean => {
  if (event.defaultPrevented) return false;
  if (pathHas(event, EDITABLE)) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (pathHas(event, INTERACTIVE) && !(target?.matches(CHAT_TAB) ?? false)) return false;
  // A layer the rail sits in (the narrow window's sheet, the editor view) is not one over it.
  return ![...document.querySelectorAll(FLOATING_LAYER)].some((layer) => !layer.contains(rail));
};

/** Whether a key in the rail types into the composer. */
export const typesIntoComposer = (event: KeyboardEvent, rail: Element): boolean => {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return false;
  if (event.key === " " && event.target instanceof Element && event.target.matches(CHAT_TAB)) return false;
  return redirectable(event, rail);
};

/** Whether Cmd+Shift+V (Ctrl+Shift+V off Mac) pressed in the rail asks the next redirected paste to stay inline. */
export const pastesInline = (event: KeyboardEvent, rail: Element, mac: boolean): boolean =>
  (mac ? event.metaKey : event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "v" && redirectable(event, rail);

/** The text a paste in the rail brings to the composer, or null when it is not the composer's. */
export const pasteIntoComposer = (event: ClipboardEvent, rail: Element): string | null => {
  if (!event.clipboardData || event.clipboardData.files.length > 0) return null;
  if (!redirectable(event, rail)) return null;
  const text = event.clipboardData.getData("text/plain");
  return text.length > 0 ? text : null;
};
