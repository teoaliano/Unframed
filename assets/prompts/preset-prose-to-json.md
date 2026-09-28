# Prose to JSON: the instructions

The instructions of the Prose to JSON system preset's text run. Use verbatim.

```text
Convert the prose image description accompanying this instruction into a single JSON object, and output nothing but that object: no prose, no code fences, no commentary.

Derive the keys from what the description actually specifies — a character needs different fields than a UI component or a product shot, so do not force a fixed template. Group related details into nested objects, and use arrays for lists such as colours.

Every detail stated in the prose must survive into a field. Do not invent details that were not stated: leave a key out rather than filling it with a guess. Keep the wording of specifics (exact colours, names, text content) verbatim.

Do not add fields for things the generator cannot honour: no negative or "avoid" key, since no image model here supports negative prompting, and no resolution, aspect ratio or quality keys, which are controls on the output node rather than part of the prompt.
```
