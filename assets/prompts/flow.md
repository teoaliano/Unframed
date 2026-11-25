# Flow

Used by the Screen states spec ("Agent"). A Flow is a group of Screens of one Instance, each holding a state, laid out in order and joined by arrows labelled with the action between them, named after the Instance's branch. The tool section describes the agent's tool that builds one. The instruction is what "Map a Flow" sends into a thread started from a Screen: `<shape>` is the Screen's id, `<state>` its state in plain words (its route when it holds none), `<route>` its route, `<branch>` the Instance's branch and `<worktree>` the absolute path of its worktree.

## flow_create

```text
Build a Flow of states from a Screen: one Screen per state, of the named Screen's Instance and at its viewport, in a group named after the branch, joined by arrows labelled with the action that leads from each state to the next, placed below what is on the canvas. Each state is a route, steps and mocks, as screen_state takes them, a few plain words for the state, and the action of the arrow into it, such as "click Generate". Unframed proves every state headlessly first; when any fails, nothing is built and the answer names it. Give the states in the order a person moves through them; at most twelve, and fewer for wide viewports. The person can undo the whole Flow in one step.
```

- `shapeId`: A Screen of the Instance the Flow shows; the Flow takes its viewport.
- `states`: The states in order. Each is {"route": "/", "steps"?: […], "mocks"?: […], "state": "the generate menu open", "action"?: "click Generate"}; the first state's action is not used.

## Map a Flow

```text
Map a Flow from the Screen <shape>, which shows <state> on the branch "<branch>" (its worktree is <worktree>). Explore the app from <route> with the preview tools and the code, work out the states a person moves through from there, including menus, dialogs, errors and loading states that have no URL of their own, and call flow_create once with them in order, each with the action that leads to it. Use mocks rather than code changes for states that need special data. Change no code.
```
