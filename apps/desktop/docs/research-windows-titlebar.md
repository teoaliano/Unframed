# Customising the Windows title bar in Electron

Research notes for the decision about the caption buttons on Windows. Everything
here was checked against the source that owns the behaviour: Electron at the tag
this repo pins (`v33.4.11`), the Chromium mirror at the release Electron 33 is
built on (`130.0.6723.152`), Microsoft Learn for the Win32 contract, and the
public source of the apps named. Where a claim could not be traced to a primary
source it says so instead of asserting it.

## Summary

What you can change with `titleBarOverlay`:

- the overlay background colour (`color`),
- the glyph colour (`symbolColor`),
- the height of the overlay strip (`height`), with a floor — see below.

That is the whole list. There is no fourth property.

What you cannot change:

- **Button width.** Fixed at 45 DIP per button plus 1 DIP of spacing, a
  hard-coded Chromium constant. Electron never sets it.
- **Glyph size.** Fixed at 10 DIP square, computed in the paint code.
- **Glyph shape.** Drawn in C++ with Skia. No API replaces them.
- **Making the bar shorter than the system caption height.** A `height` below
  `SM_CYCAPTION` is silently ignored.

So the buttons look large because 45 × 10 is the ratio Chromium ships, and
raising `height` makes the hover rectangle taller without making the glyph
bigger — which is the opposite of what the "too large" complaint usually wants.
The only lever on "too dark" is `symbolColor` and `color`.

The alternative — `frame: false` and buttons drawn in HTML — gets you complete
visual control and **costs you the Windows 11 Snap Layouts flyout**, with no
workaround available from JavaScript. Recovering it needs a native addon that
answers `WM_NCHITTEST` with `HTMAXBUTTON`, and Electron's hit-test path never
returns that value outside the overlay code.

`-webkit-app-region: drag` **does** work on a `::before`/`::after`, but only if
the pseudo-element generates a *box* (`display: block` or similar), and on
Electron 33 the property does not inherit, so it must be set on the pseudo
itself. Verified in Blink source, not inferred.

---

## 1. What `titleBarOverlay` accepts, and where the sizes come from

### The complete property set

Three properties, at construction and at `setTitleBarOverlay()`:

```js
titleBarOverlay: { color, symbolColor, height }
```

Documented in
[`docs/api/structures/base-window-options.md`](https://github.com/electron/electron/blob/v33.4.11/docs/api/structures/base-window-options.md)
(`titleBarOverlay`) and
[`win.setTitleBarOverlay`](https://github.com/electron/electron/blob/v33.4.11/docs/api/browser-window.md).
The main-process implementation reads exactly those three keys and nothing else:
[`NativeWindowViews::SetTitleBarOverlay`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_views.cc)
parses `overlayButtonColor`, `overlaySymbolColor`, `overlayHeight`, and throws
`TypeError: Titlebar overlay is not enabled` if the window was not constructed
with the overlay. Colours go through `content::ParseCssColorString`, so any CSS
colour form works, alpha included.

Note that `color` is *not* only the strip behind the buttons: the same value is
used as each button's own background fill
([`WinCaptionButton::OnPaintBackground`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_caption_button.cc))
and as the container background
(`WinCaptionButtonContainer::UpdateBackground`). If the buttons read as too
dark, `color` is as likely to be the cause as `symbolColor`.

### Where the button width comes from

A Chromium constant, not an OS metric and not anything Electron computes:

```cpp
static constexpr int kWindowsCaptionButtonWidth = 45;
static constexpr int kWindowsCaptionButtonHeightRestored = 29;
static constexpr int kWindowsCaptionButtonVisualSpacing = 1;
```

[`chrome/browser/ui/frame/window_frame_util.h`, lines 18–20, at 130.0.6723.152](https://github.com/chromium/chromium/blob/130.0.6723.152/chrome/browser/ui/frame/window_frame_util.h#L18-L20)

Electron's button seeds its own fields from those constants:

```cpp
int base_width_ = WindowFrameUtil::kWindowsCaptionButtonWidth;
int height_ = WindowFrameUtil::kWindowsCaptionButtonHeightRestored;
```

[`shell/browser/ui/views/win_caption_button.h`, lines 73–74](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_caption_button.h#L73-L74)

These are device-independent pixels. Views scales them by the window's DPI
scale factor, so at 150% the buttons are 67.5 physical pixels wide — the *number*
does not come from DPI, only its final size does. The source carries an
acknowledgement that this is not DPI-correct against real Windows buttons:
"the sizes in this function are for 1x device scale and don't match Windows
button sizes at hidpi" (`WinCaptionButton::CalculatePreferredSize`).

Three buttons at 45 + 1 = 138 DIP total. That number shows up in VS Code's own
CSS as the width it reserves for the overlay (see §3).

### What `height` actually changes

`WinFrameView::LayoutCaptionButtons` computes a height and pushes it into the
buttons as `gfx::Size(0, height)` — width zero:

```cpp
caption_button_container_->SetButtonSize(gfx::Size(0, height));
```

[`shell/browser/ui/views/win_frame_view.cc`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_frame_view.cc)

and `WinCaptionButton::SetSize` ignores any dimension that is not positive
(`if (width > 0) base_width_ = width;`). So `height` moves the button's height
only. Width stays 45 forever.

The glyph is unaffected. It is drawn at a fixed 10 DIP square, centred in the
button's contents box:

```cpp
const int symbol_size_pixels = base::ClampRound(10 * scale);
...
symbol_rect.ClampToCenteredSize(gfx::Size(symbol_size_pixels, symbol_size_pixels));
```

[`win_caption_button.cc`, line 167](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_caption_button.cc#L167)
(`scale` is the device scale factor the canvas just undid, so 10 × scale
physical pixels is 10 DIP.)

**So: `height` changes the hit area and the painted hover/press rectangle, and
does not change the drawn glyph size.** Verified from source.

### The height floor

```cpp
int height = TitlebarMaximizedVisualHeight() + FrameTopBorderThickness(false) - WindowTopY();
if (custom_height > TitlebarMaximizedVisualHeight())
  height = custom_height - WindowTopY();
```

[`win_frame_view.cc`, lines 211–221](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_frame_view.cc#L211-L221)

`TitlebarMaximizedVisualHeight()` is `GetSystemMetricsInDIP(SM_CYCAPTION)` — the
system caption height ([`SM_CYCAPTION`, GetSystemMetrics on Microsoft
Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getsystemmetrics)).
A `height` at or below that value is discarded and the system height is used.
You can make the title bar taller than Windows'; you cannot make it shorter.

## 2. Replacing or restyling the glyphs

No. There is no Electron API and no Chromium API for it.

The glyphs are painted procedurally in C++ against a Skia canvas:
`WinIconPainter` draws a line for minimise, a rectangle for maximise, two offset
rectangles for restore, and two strokes for close; `Win11IconPainter` overrides
the maximise/restore shapes with a 1.5px corner radius on Windows 11
([`win_icon_painter.cc`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_icon_painter.cc),
selected by version check in
[`WinCaptionButton::CreateIconPainter`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_caption_button.cc)).
The only value that reaches the paint from JavaScript is `symbolColor`, via
`window()->overlay_symbol_color()`.

Two behaviours are hard-coded and not overridable:

- The close button's hover fill is `#E81123` at full opacity, and its glyph
  turns white on hover or press, whatever `symbolColor` says.
- The other buttons' hover/press fills are the *foreground* colour at alpha
  0x1A / 0x33, scaled by 1.3 when `color` has any alpha.

Both in `WinCaptionButton::OnPaintBackground` / `PaintSymbol`, same file.

The Window Controls Overlay spec is no help either: it exposes only geometry and
a visibility flag to the page — `titlebar-area-*` env vars,
`navigator.windowControlsOverlay`, `geometrychange` — and says nothing about
styling the buttons ([WICG Window Controls
Overlay](https://wicg.github.io/window-controls-overlay/), [explainer](https://github.com/WICG/window-controls-overlay/blob/main/explainer.md)).

Changing the glyphs means patching Chromium/Electron and shipping your own
build, or abandoning the native overlay entirely.

## 3. What the named apps do

### VS Code — verified from source

VS Code uses **(a) the native overlay with styling, by default**, and ships
**(b) HTML-drawn controls as an opt-in setting**.

- It constructs windows with `titleBarStyle: 'hidden'` and drives the overlay
  through `setTitleBarOverlay`, passing exactly `color`, `symbolColor` and
  `height`:
  [`src/vs/platform/windows/electron-main/windowImpl.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/windows/electron-main/windowImpl.ts)
  (`updateWindowControls`). It passes `height: options.height - 1`, commented
  "account for window border".
- The default title bar height is 35 DIP:
  `DEFAULT_CUSTOM_TITLEBAR_HEIGHT = 35`, in
  [`src/vs/platform/window/common/window.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/window/common/window.ts),
  which also holds `useWindowControlsOverlay()`.
- There is a user setting `window.controlsStyle` with values
  `native | custom | hidden`, default `native`, Windows/Linux only:
  [`src/vs/workbench/electron-browser/desktop.contribution.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/electron-browser/desktop.contribution.ts).
  `custom` draws the controls in the DOM; `hidden` draws none.
- The DOM side reserves space for the native overlay rather than drawing over
  it: `.window-controls-container { width: calc(138px / var(--zoom-factor, 1)) }`
  — the same 3 × 46 the Chromium constants produce — and marks the container
  `-webkit-app-region: no-drag`. Its own drawn icons are 46px wide with a 16px
  glyph:
  [`src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css).
- It also handles Electron's `system-context-menu` event so right-clicking the
  custom title bar still raises the system menu
  ([`windowImpl.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/windows/electron-main/windowImpl.ts);
  the event is documented in
  [`browser-window.md`](https://github.com/electron/electron/blob/v33.4.11/docs/api/browser-window.md)).

Worth noting: VS Code offers the HTML option and still defaults to the native
overlay. The default is the answer of a team that has been at this for years.

### Discord, Slack — not verified

Neither ships source, and neither has published an engineering post that
describes its Windows title bar implementation. Searches restricted to
`discord.com` and the vendors' own properties turned up nothing primary; the
material that exists is third-party theming projects and tutorials, which this
document does not treat as evidence. **Their approach is unknown.** Anything you
read claiming Discord draws its buttons in HTML is inference from a screenshot.

There is one cheap first-party test the team can run in ten seconds each:
hover the maximise button on Windows 11. If the Snap Layouts flyout appears, the
app is either using the native overlay or answering `WM_NCHITTEST` with
`HTMAXBUTTON` from native code; if nothing appears, the buttons are drawn in
HTML with no native hit-test. That distinguishes (a)/(c) from (b) without
guessing.

The one adjacent primary datum: an Electron bug report about Snap Layouts names
"VS Code, Discord, Figma, Skype, Postman" as behaving alike on a *different*
snap issue ([electron/electron#40706](https://github.com/electron/electron/issues/40706)),
which tells you they are all Electron but nothing about their title bars.

### Arc — verified, and not comparable

Arc on Windows is **not an Electron app**. The Browser Company built it in
Swift, and maintains its own Swift toolchain builds for Windows
([thebrowsercompany/swift-build](https://github.com/thebrowsercompany/swift-build),
plus [the org's Swift/WinRT repositories](https://github.com/orgs/thebrowsercompany/repositories)).
It paints its own non-client area from native code, category (c). Matching Arc's
caption buttons from Electron means matching them by hand in HTML and paying the
costs in §4 — there is no configuration that gets you there.

## 4. Snap Layouts and `frame: false`

### What triggers Snap Layouts

Microsoft documents it precisely: the system shows the flyout when the pointer
hovers the maximize caption button, and for a Win32 app with a custom title bar
that means the window procedure must answer `WM_NCHITTEST` with `HTMAXBUTTON`
over the maximise button's rectangle.

> make sure you are responding appropriately to WM_NCHITTEST (with a return
> value of `HTMAXBUTTON` for the maximize/restore button)

[Support snap layouts for desktop apps on Windows 11 — Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
([doc source](https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/apps/desktop/modernize/ui/apply-snap-layout-menu.md))

The same page notes the app should support a minimum width of at most 500
effective pixels for snap layouts to be offered across common screen sizes.

### Does `titleBarOverlay` preserve them? Yes — from source, not from docs

`WinCaptionButtonContainer::NonClientHitTest` returns `HTMINBUTTON`,
`HTMAXBUTTON` (for both the maximize and restore buttons), `HTCLOSE`, and
`HTCAPTION` for the rest of the strip:

[`win_caption_button_container.cc`, lines 95–108](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_caption_button_container.cc#L95-L108)

and `WinFrameView::NonClientHitTest` forwards to it whenever the overlay is
enabled ([`win_frame_view.cc`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/win_frame_view.cc)).
That is the exact contract Microsoft's page asks for, so Snap Layouts work.

**This is not documented anywhere in Electron's own docs.** Neither the
`titleBarOverlay` reference nor the custom-title-bar tutorial mentions Snap
Layouts. The behaviour is real but undocumented, which means it is not a
promise: it is a consequence of the current implementation.

### Does `frame: false` lose them? Yes

With `frame: false` and no overlay, the frame view is plain `FramelessView`, and
its `NonClientHitTest` can only return resize components, `HTCLIENT`, or
whatever the draggable-region providers return
([`frameless_view.cc`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/ui/views/frameless_view.cc)).
The provider for web contents returns `HTCAPTION` and nothing else:

```cpp
SkRegion* region = api_web_contents_->draggable_region();
if (region && region->contains(local_point.x(), local_point.y()))
  return HTCAPTION;
```

[`electron_api_web_contents_view.cc`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/api/electron_api_web_contents_view.cc)

`HTMAXBUTTON` is never produced on that path. **No Snap Layouts, and there is no
CSS or JavaScript that can change it.** Dragging-to-snap and Win+arrow snapping
still work, because those follow from `HTCAPTION` and from the window being a
normal resizable window; only the hover flyout is lost.

### Can you get them back?

- **Electron API:** none. The feature request for exactly this
  ([electron/electron#31372](https://github.com/electron/electron/issues/31372),
  "Added support to show the Window SNAP box on windows 11 for frameless
  windows") was closed with a maintainer pointing at the Window Controls Overlay
  as the supported answer, and adding: "There is no documented Windows API to
  programmatically show the snap control." The thread's own conclusion is that
  the hit test must return 9 — `HTMAXBUTTON` — which only the overlay path does.
- **Documented Win32 approach:** yes, the Microsoft page above, but it is a
  window-procedure change. Electron exposes `win.hookWindowMessage()`, which
  observes messages; it does not let you supply the `LRESULT` for
  `WM_NCHITTEST`. So this is not reachable from JavaScript.
- **Native addon:** possible in principle — subclass the HWND, answer
  `WM_NCHITTEST` with `HTMAXBUTTON` over your HTML button's rectangle, and then
  also handle `WM_NCMOUSEMOVE`, `WM_NCMOUSELEAVE`, `WM_NCLBUTTONDOWN` and
  `WM_NCLBUTTONUP` yourself, because once you claim a non-client hit test the
  ordinary mouse events stop arriving in the page for that rectangle. That is a
  real native module to build, sign, ship for x64 and arm64, and keep working
  across Electron upgrades. No such addon was found that is maintained and
  primary-sourced; treat it as work to be written, not a dependency to add.

**Verdict:** custom-drawn buttons cost Snap Layouts unless you write and
maintain a native addon.

## 5. `-webkit-app-region: drag` on `::before` / `::after`

**It works, with two conditions.** Verified in Blink source at the Chromium
release Electron 33 ships.

The region collection walks the **layout tree**, not the element tree, and
recurses through every child layout object:

```cpp
void LocalFrameView::CollectDraggableRegions(LayoutObject& layout_object,
                                             Vector<DraggableRegionValue>& regions) const {
  if (layout_object.IsText())
    return;
  layout_object.AddDraggableRegions(regions);
  for (LayoutObject* curr = layout_object.SlowFirstChild(); curr;
       curr = curr->NextSibling())
    CollectDraggableRegions(*curr, regions);
}
```

[`local_frame_view.cc`, lines 4187–4199 at 130.0.6723.152](https://github.com/chromium/chromium/blob/130.0.6723.152/third_party/blink/renderer/core/frame/local_frame_view.cc#L4187-L4199)

A generated `::before`/`::after` with a `content` value has a layout object in
that tree, so it is visited. There is no element-only filter anywhere in the
path.

The per-object collector is where the conditions live:

```cpp
void LayoutObject::AddDraggableRegions(Vector<DraggableRegionValue>& regions) {
  if (StyleRef().UsedVisibility() != EVisibility::kVisible || !IsBox()) {
    return;
  }
  if (StyleRef().DraggableRegionMode() == EDraggableRegionMode::kNone) {
    return;
  }
  auto* box = To<LayoutBox>(this);
  ...
}
```

[`layout_object.cc`, lines 4351–4370 at 130.0.6723.152](https://github.com/chromium/chromium/blob/130.0.6723.152/third_party/blink/renderer/core/layout/layout_object.cc#L4351-L4370)

So:

1. **The pseudo-element must generate a box.** `!IsBox()` bails out. A default
   `::before { content: "" }` is `display: inline` and produces a `LayoutInline`,
   which is not a `LayoutBox` — it will be skipped silently. Give it
   `display: block` (or `inline-block`, `flex`, …) and it is collected. It must
   also be `visibility: visible`, and having non-zero size is implied by the
   region being its border-box rect.
2. **On Electron 33 the property does not inherit, so set it on the pseudo
   itself.** `app-region` is declared without `inherited: true`
   ([`css_properties.json5`](https://github.com/chromium/chromium/blob/130.0.6723.152/third_party/blink/renderer/core/css/css_properties.json5))
   and its style-builder `ApplyInherit` is an empty function
   ([`longhands_custom.cc`, `AppRegion::ApplyInherit`](https://github.com/chromium/chromium/blob/130.0.6723.152/third_party/blink/renderer/core/css/properties/longhands/longhands_custom.cc)).
   A `::before` inside a `app-region: drag` parent contributes nothing on its
   own; write `app-region: drag` in the pseudo's own rule.

The document-level gate is satisfied automatically: `AppRegion::ApplyValue`
calls `state.GetDocument().SetHasDraggableRegions(true)` whenever the property is
applied, and the same style builder runs for pseudo-element styles, so declaring
it only on a pseudo still arms `UpdateDocumentDraggableRegions`.

**Platform differences:** none in this code — collection is
platform-independent Blink, and the same regions are handed to whichever
embedder consumes them. What differs is downstream: Windows/Linux turn the
region into an `HTCAPTION` hit test (§4), macOS applies it to the `NSView`. The
one gate that could differ is `ChromeClient::SupportsDraggableRegions()`, which
Electron enables on all three desktop platforms — its draggable-region docs are
written without platform qualifiers
([custom-window-interactions.md](https://github.com/electron/electron/blob/v33.4.11/docs/tutorial/custom-window-interactions.md)).

**Caution about relying on this.** It works today, and it is a byproduct of the
layout-tree walk rather than a specified behaviour — nothing in Chromium's docs
or in the CSS spec drafts says pseudo-elements participate. Chromium `main` has
already reworked the property: `app-region` is now a surrogate for a new
`window-drag` property behind the `CSSWindowDrag` runtime flag, and **that one
is `inherited: true`**
([`css_properties.json5` on main](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/css/css_properties.json5)).
When Electron catches up to that Chromium, drag-ness will start inheriting into
descendants and pseudo-elements that previously had none. Plan for the pseudo
approach to need a re-test on the Electron upgrade that crosses it.

## 6. Other things worth knowing before deciding

**A draggable region swallows every pointer event over it.** Electron's own docs
are blunt about it: "draggable areas ignore all pointer events… a button element
that overlaps a draggable region will not emit mouse clicks or mouse enter/exit
events within that overlapping area"
([custom-window-interactions.md](https://github.com/electron/electron/blob/v33.4.11/docs/tutorial/custom-window-interactions.md)).
Every interactive control in a custom title bar needs an explicit
`app-region: no-drag`, and the regions are *rectangles*, so a round or inset
button still blocks the corners of its bounding box.

**Regions are recomputed on layout, not on paint.** `UpdateDocumentDraggableRegions`
runs from `LocalFrameView` post-layout, and `app-region` is declared
`invalidate: ["layout"]`. Changing drag-ness forces a layout pass; animating it
is a bad idea.

**Right-click on a drag region raises the system menu.** Electron surfaces it as
the `system-context-menu` event on Windows, and the docs warn against putting a
custom context menu on a draggable area
(both in the links above). VS Code handles this event; a naive custom title bar
does not, and users notice.

**The overlay strip is unusable by the page.** From the Electron tutorial: "when
`titleBarOverlay` is enabled, the window controls become exposed in their default
position, and DOM elements cannot use the area underneath this region"
([custom-title-bar.md](https://github.com/electron/electron/blob/v33.4.11/docs/tutorial/custom-title-bar.md)).
Use `env(titlebar-area-x)` / `env(titlebar-area-width)` to keep content clear;
the buttons are also mirrored to the left in RTL locales
(`WinCaptionButton::GetButtonDisplayOrderIndex`), which a hard-coded right-side
padding will get wrong.

**`setTitleBarOverlay` throws if the overlay was not enabled at construction.**
You cannot turn the overlay on later; `titleBarOverlay` must be present in the
`BrowserWindow` options (`NativeWindowViews::SetTitleBarOverlay`, cited in §1).
`titleBarStyle` must also be something other than `default`
([custom-title-bar.md](https://github.com/electron/electron/blob/v33.4.11/docs/tutorial/custom-title-bar.md)).

**Height and DPI are still being fixed upstream.** There is an open PR against
Electron for rounding errors in the custom overlay height at fractional scale
factors ([electron/electron#52242](https://github.com/electron/electron/pull/52242),
"avoid split DPI rounding for custom titlebar overlay height"). If the app is
tested only at 100%, expect a one-pixel seam at 125% and 150%.

**Known rough edges in the overlay, from Electron's own tracker:** the maximize
button misbehaving on external monitors
([#35245](https://github.com/electron/electron/issues/35245)), hover effects not
firing ([#32360](https://github.com/electron/electron/issues/32360)), and the
caption controls' accessibility ([#25984](https://github.com/electron/electron/issues/25984)).
All closed, but they map the shape of the area.

**If you go the HTML route, budget for what the native buttons give you free:**
Snap Layouts (§4), correct hover/press timing including the close button's red
fill, tooltips and accessible names in the user's locale
(`UpdateButtonToolTipsForWindowControlsOverlay` uses `IDS_APP_ACCNAME_*`),
RTL mirroring, disabling minimise/maximise when the window forbids them
(`WinCaptionButtonContainer::UpdateButtons`), and swapping maximize for restore
on state change. Each of those is a small thing you now own.

---

### Confidence

| Claim | Basis |
| --- | --- |
| Three overlay properties, no more | Electron docs + `NativeWindowViews::SetTitleBarOverlay` — verified |
| 45/29/1 DIP constants; 10 DIP glyph | Chromium 130 and Electron v33 source — verified |
| `height` moves hit area only, not glyph | `LayoutCaptionButtons` + `PaintSymbol` — verified |
| `height` below `SM_CYCAPTION` ignored | `TitlebarHeight` — verified |
| Glyphs not replaceable | absence of any API + procedural painter — verified as far as absence can be |
| Overlay path preserves Snap Layouts | `NonClientHitTest` returns `HTMAXBUTTON` — verified in source, undocumented |
| `frame: false` loses Snap Layouts | `FramelessView` + `HTCAPTION`-only provider — verified |
| Native addon could restore them | inferred from the Microsoft contract; no working primary example found |
| Pseudo-elements are collected as drag regions | Blink `CollectDraggableRegions` / `AddDraggableRegions` — verified |
| `app-region` non-inherited on Electron 33 | `ApplyInherit` is empty — verified |
| VS Code: native overlay by default, HTML as opt-in | microsoft/vscode source — verified |
| Arc: native, Swift, not Electron | The Browser Company repositories — verified |
| Discord, Slack | **not verified**, no primary source exists |
