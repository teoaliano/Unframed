# Screen drafts

Used by the Screen direct edit spec ("Apply and check"). When the person applies their hand edits in the Screen editor, the changes Unframed cannot write into the code itself, the ones the person scoped to one instance, and the ones that did not take on the reloaded page go to the Screen's agent thread as this message: `<shape>` is the Screen's id, `<branch>` the Instance's branch, `<state>` the Screen's state in plain words or its route, `<worktree>` the Instance's worktree and `<changes>` one line per change, from the change lines below.

## Instruction

```text
Make these changes in the app shown by the Screen <shape> on the branch "<branch>", at <state>. The person made them by hand in the Screen editor, and Unframed could not write them into the code itself. Each line names the JSX that renders the element, the change, and why it was left to you:

<changes>

Work in the Instance's worktree at <worktree>, and nowhere else. Make each change at the place named, the way the project already styles its components, so that the Screen shows it. Leave the change uncommitted.
```

## Change lines

One line per change: `- <kind> in "<component>" at "<file>":<line>:<col>–<endLine>:<endCol>`, then, when the JSX renders more than one element on the page, `, instance <n> of <count>` and whether to change only this one or every one, then the change (`class <before> → <after> (<token>, <value>)` for a Tailwind class, `<property> "<before>" → "<after>"` otherwise), then the reason Unframed left it: the writer's refusal, the scope, or that the page did not show it after the write. `<kind>` is the element in plain words (Header, Heading, List item). An element with no JSX of its own names the nearest JSX and its CSS path. The file is the one the engine found in the worktree; when it found none, the line names the CSS path instead. Text the page reported (the component, the CSS path, the file) is quoted on one line.
