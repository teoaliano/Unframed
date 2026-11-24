# Flow

Used by the Repositories spec ("Screens and Flows"). A Flow is a group of Screens of one Instance, laid out in route order and joined by arrows, named after the Instance's branch. The tool section describes the agent's tool that makes one. The instruction is what "Ask the agent" sends into a thread started from the Screen: `<shape>` is the Screen's id, `<route>` its route, `<branch>` the Instance's branch and `<worktree>` the absolute path of its worktree.

## screen_explode

```text
Lay out an Instance's routes as a Flow: one Screen per route, at the named Screen's viewport, in a group named after the branch, joined by arrows in the order given, placed below what is on the canvas. Give routes as paths in the order a person moves through the app, such as ["/", "/pricing", "/checkout"]; at most twelve, and fewer for wide viewports.
```

- `shapeId`: A Screen of the Instance to lay out.
- `routes`: The routes, in order.

## Propose routes

```text
Explode the Screen <shape> into a Flow: read the router in the Instance's worktree at <worktree> (the branch "<branch>"), work out the routes a person moves through, starting from <route>, in that order, and call screen_explode with them. Leave out routes that need an id you cannot know, and say which you left out. Change no code.
```
