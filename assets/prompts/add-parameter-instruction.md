# "Add a parameter" instruction

What the editor's "Add a parameter" box sends into the artifact's chat. `<wanted>` is what the person typed, trimmed. `<kind>` is `page` or `motion`, `<title>` the artifact's title. Use "parameters" when `<wanted>` contains the word "and" or a comma, else "a parameter". The sentences are joined with single spaces into one message.

```text
Add <wanted> as <a parameter | parameters> on the <kind> "<title>". Expose them with a single `unframed.dials` call so they appear in the Parameters column, and make the callback actually apply each value. If any of them is part of the animation rather than just dressing, wire it into the timeline — rebuild the timeline from the values instead of setting an animated property alongside it — and express anything that changes over time as its start, its end and a duration. Keep every parameter it already has, and change nothing else about it.
```
