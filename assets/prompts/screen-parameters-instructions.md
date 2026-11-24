# Screen parameters instructions

What the Parameters panel sends into the agent thread for a Screen (spec: Repositories, Parameters). A Screen shows one route of one Instance, so the instructions name the Instance's branch and its worktree instead of a page. `<name>` is the declaration's announced name, `<route>` the Screen's route, `<branch>` the Instance's branch, `<worktree>` the absolute path of its worktree, `<wanted>` what the person typed, and `<values>` the current values as JSON with two-space indents, one key per parameter path (`scene.speed`).

## Apply

````text
Update the unframed.dials configuration for "<name>" in the app shown at <route> on the branch "<branch>" with these values:

```json
<values>
```

Work in the Instance's worktree at <worktree>, and nowhere else. Apply these values as the new defaults in that unframed.dials call, keep each parameter's description, keep the call guarded as `window.unframed?.dials(...)` so the app runs unchanged outside Unframed, and leave the change uncommitted.
````

## Add

````text
Add <wanted> as <a parameter | parameters> in the app shown at <route> on the branch "<branch>". Work in the Instance's worktree at <worktree>, and nowhere else. Expose them with a single `window.unframed?.dials(...)` call in the component that renders that route, guarded so the app runs unchanged outside Unframed, give each one a short description of what it changes in the call's fourth argument (an object from each parameter's path to its description), and make the callback actually apply each value. Keep every parameter it already has, change nothing else, and leave the change uncommitted.
````
