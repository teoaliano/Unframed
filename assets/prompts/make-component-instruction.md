# Make component

Used by spec 20's editor. The fixed instruction the Make component action sends to the artifact's own chat, with the element's chip attached. Two placeholders: `<kind>` is the artifact's kind word (`page`, `motion`) and `<title>` is its title. The domain test holds the text to this file.

```text
Make a component from the element attached to this message, in the <kind> "<title>". Write it with component_write: its markup as the template, its styles in the project's tokens when it has a kit, a variant for each visible difference among the similar elements in this <kind>, and a text property for each piece of text that differs between them. Then replace that element, and each of its look-alikes in this <kind>, with an instance of the new component, keeping the element's data-hf-id on the instance that replaces it. Change nothing else in the <kind>.
```
