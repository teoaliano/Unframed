# "Apply" parameters instruction

What the Apply button in the Parameters panel and the editor's Parameters tab sends into the artifact's chat (spec 09). It is the message DialKit's own Copy button put on the clipboard, with the hook named `unframed.dials` and the artifact named. `<name>` is the declaration's announced name, `<kind>` is `page` or `motion`, `<title>` the artifact's title, and `<values>` the current values as JSON with two-space indents, one key per parameter path (`scene.speed`), the way DialKit copies them.

````text
Update the unframed.dials configuration for "<name>" on the <kind> "<title>" with these values:

```json
<values>
```

Apply these values as the new defaults in the unframed.dials call. Keep each parameter's description.
````
