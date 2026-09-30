# Dials timeline rule

Used by spec 07's Unframed MCP server and spec 09. Appended, after one space, to the motion write description only, after the dials contract: how a value the timeline owns is exposed. No placeholders.

Source: the old app's `DIALS_TIMELINE` in `server/agentTools.js`, its sentences joined with single spaces. Verbatim.

```text
When a parameter is part of the animation, build the timeline FROM the values: register it synchronously as above, then inside the callback capture `var at = tl.time()`, call `tl.clear()`, add the tweens using the values, and `tl.seek(at)`. The callback runs once at startup, so the first build is synchronous and a render builds the timeline from the saved values before its first frame; every later change rebuilds it in place, and the runtime keeps the same timeline object throughout. For example: `unframed.dials("Move", { fromX: [0, 0, 500], toX: [300, 0, 500], dur: [2, 0.5, 3] }, function (v) { var at = tl.time(); tl.clear(); tl.fromTo("#box", { x: v.fromX }, { x: v.toX, duration: v.dur }, 0); tl.seek(at); })`. Never set a tweened property directly in the callback; a purely static offset on a tweened element can instead go on a plain wrapper the timeline never touches, which is the same rule from the other side. A value that CHANGES across the timeline is not one parameter: expose its start, its end and the duration as separate controls and let the tween carry it between them. Do not try to express a curve as a parameter -- when something needs a third waypoint the motion wants rewriting, not another dial.
```
