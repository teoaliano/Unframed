# Screen element

The model-facing description of the screen_element tool on the Unframed MCP server and of its arguments. No placeholders.

## screen_element

```text
Find the JSX behind an element of a Screen. Unframed loads the Screen's route and state in a headless browser against its Instance and reads React's own development data for the first element the CSS selector matches: the file, the line and column where its JSX starts and ends, the component whose JSX holds it, the component rooted at it with its props, and how many elements on the page come from the same JSX and which one this is. Element chips the person sends from the Screen editor already carry this; call it to locate any other element before you edit, so the change lands on the right line. An element React did not render names the nearest one it did, with selfMapped false. It works on React apps in development; anything else answers that no source was found.
```

- `shapeId`: The Screen.
- `selector`: A CSS selector for the element, such as the selector of an element chip.
