# Artifact performance paragraph

Appended to the page and motion write tool descriptions (spec 09), after the dials text. New text, written for the rewrite.

```text
Performance: the canvas shows many artifacts at once, so keep yours cheap. Animate on demand: draw once at startup and again when a parameter changes, rather than every frame, unless the thing is an animation. When you do need a loop, stop it while `document.hidden` is true or while the page is off screen (use an IntersectionObserver on the root element), and never call `getImageData` or read pixels back from a canvas inside the loop. Prefer CSS transitions and transforms to JavaScript that sets styles every frame. Keep canvases at their displayed size times `devicePixelRatio`, not larger.
```
