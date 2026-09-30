# Preview tool descriptions

Used by spec 08. The model-facing descriptions of the twelve preview tools on spec 07's Unframed MCP server, and of their arguments. No placeholders.

Source: t3code (github.com/pingdotgg/t3code, MIT licence), `apps/server/src/mcp/toolkits/preview/tools.ts` for the tool descriptions and `packages/contracts/src/previewAutomation.ts` for the argument descriptions. Rewritten as spec 08 describes: each chat has one tab, so no tool takes a `tabId`; a tab opens a page or motion named by `shapeId`, so no tool takes a URL or a dev-server target; the snapshot has no `save` option; and the recording tools are left out. Every other sentence is t3code's text.

## preview_status

No arguments.

```text
Report whether this agent session's browser tab exists and is automation-capable, including the page or motion it shows, its URL, title, loading state, viewport mode, and measured CSS-pixel size.
```

## preview_open

```text
Initialize this agent session's browser tab on the page or motion named by shapeId, or reuse the tab when it already exists. A motion opens in its viewer.
```

- `shapeId`: The page or motion shape to open.

## preview_navigate

```text
Navigate this agent session's browser tab to another page or motion of this project, named by shapeId. No other destinations exist.
```

- `shapeId`: The page or motion shape to show.

## preview_resize

```text
Resize this agent session's browser tab. Use {mode:'fill'}, {mode:'freeform',width:1024,height:768}, or {mode:'preset',preset:'iphone-12-pro',orientation:'portrait'}. This changes CSS layout breakpoints without changing the desktop browser user agent.
```

- `mode`: Viewport mode: fill follows the preview panel, freeform uses exact independently resizable dimensions, and preset uses a named device size.
- `preset`: Named device size. Required only when mode is preset.
- `width`: Freeform viewport width in CSS pixels. Required only in freeform mode.
- `height`: Freeform viewport height in CSS pixels. Required only in freeform mode.
- `orientation`: Orientation for a named device preset. It is not accepted in fill or freeform mode.

## preview_set_appearance

```text
Emulate prefers-color-scheme in this agent session's browser tab. Use {colorScheme:'dark'} or {colorScheme:'light'} to preview the page in that appearance, and {colorScheme:'system'} to clear the override and follow the OS appearance.
```

- `colorScheme`: Emulated prefers-color-scheme for the page: light, dark, or system to follow the OS appearance.

## preview_snapshot

```text
Inspect a page before interacting. Returns page state, semantic elements, diagnostics, action history, and a PNG screenshot. Set includeImage=false for text-only output with the same page metadata.
```

- `includeImage`: Include the PNG image in the tool response. Defaults to true. Set false for text-only output.

## preview_click

```text
Click exactly one target in this agent session's browser tab. Prefer a Playwright locator; selector accepts legacy CSS; x and y must be supplied together.
```

- `locator`: Playwright selector, preferably role/text based, for example role=button[name='Send'] or text=Continue. Use snapshot first to inspect the page.
- `selector`: Legacy CSS selector such as button[type='submit']. Prefer locator for resilient role/text targeting.
- `x`: Viewport-relative X coordinate in CSS pixels. Must be paired with y.
- `y`: Viewport-relative Y coordinate in CSS pixels. Must be paired with x.

## preview_type

```text
Insert literal text into one input in this agent session's browser tab. Prefer a Playwright locator; set clear=true to replace existing text.
```

- `text`: Literal text to insert.
- `locator`: Playwright selector for the input, for example role=textbox[name='Message'] or textarea[placeholder*='Message'].
- `selector`: Legacy CSS selector for the input. Prefer locator.
- `clear`: Clear the existing input value before inserting text. Defaults to false.

## preview_press

```text
Press one keyboard key in this agent session's browser tab. Examples: {key:'Enter'}, {key:'Escape'}, or {key:'a',modifiers:['Meta']}.
```

- `key`: Keyboard key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character.
- `modifiers`: Modifier keys held while pressing key.

## preview_scroll

```text
Scroll this agent session's browser tab. Positive deltaY scrolls down and positive deltaX scrolls right; a locator/selector targets a container.
```

- `deltaX`: Horizontal scroll delta in CSS pixels. Positive scrolls right. Defaults to 0.
- `deltaY`: Vertical scroll delta in CSS pixels. Positive scrolls down. Defaults to 0.
- `locator`: Playwright selector for a scrollable container. Omit to scroll the viewport.
- `selector`: Legacy CSS selector for a scrollable container. Omit to scroll the viewport.

## preview_evaluate

```text
Evaluate JavaScript in this agent session's browser tab. Returns {value} with a serializable result up to 64 KB; the expression may mutate page state.
```

- `expression`: JavaScript expression evaluated in the page's main frame, for example document.title or (() => ({href: location.href}))().

## preview_wait_for

```text
Wait in this agent session's browser tab until all supplied locator, selector, and text conditions match.
```

- `locator`: Playwright selector that must match an element, for example role=button[name='Send'].
- `selector`: Legacy CSS selector that must match an element. Prefer locator.
- `text`: Case-sensitive substring that must appear in visible document text.
- `timeoutMs`: Maximum wait in milliseconds. Defaults to 15000; maximum 60000.
