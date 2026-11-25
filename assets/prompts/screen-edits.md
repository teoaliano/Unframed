# Screen edits

Used by the Screen editor spec ("Edit mode inside a Screen"). The instruction is what the Screen editor writes into the composer draft of a Screen's chat while the person changes elements in Edit mode: `<shape>` is the Screen's id, `<branch>` the Instance's branch, `<state>` the Screen's state in plain words or its route, `<worktree>` the Instance's worktree and `<changes>` one line per changed element, from the change lines below.

## Instruction

```text
Make these changes in the app shown by the Screen <shape> on the branch "<branch>", at <state>. The person tried them in the Screen editor as overrides on the running page, which are not saved. Each line names an element by a CSS path that finds it in the page as it renders, not in a source file, and says what to change:

<changes>

Work in the Instance's worktree at <worktree>, and nowhere else. Find the code that renders each element and make the change there, the way the project already styles and writes its components, then check that the Screen shows it. Leave the change uncommitted.
```

## Change lines

One line per element, `- <name> (<path>): ` followed by its changes joined by `; `: a style is `<property>: <value>`, a removed style `remove <property>`, new text `text "<text>"`, and visibility `hidden` or `shown`.
