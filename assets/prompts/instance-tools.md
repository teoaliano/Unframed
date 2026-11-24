# Instance tools

Used by the Repositories spec ("Agent"). The model-facing descriptions of the Instance tools on the Unframed MCP server, of their arguments, and the sentences the canvas and preview tools gain in a Repository. Each section names a tool, or the tool whose description a sentence is added to. No placeholders.

## instance_create

```text
Create a new Instance of this Repository: a new branch checked out in its own worktree, with the Repository's env files and Setup's files copied in and its setup command run. Name a Screen with shapeId to fork that Screen's Instance from its branch tip, or name a base branch with base; with neither, the new branch starts from the branch the Repository was added on. A Screen for the new Instance is placed beside the others at the same route and viewport. The answer gives the Instance's id, branch and the absolute path of its worktree: edit that Instance's code there, with your own file tools and absolute paths. Never commit unless the person asks.
```

- `shapeId`: A Screen whose Instance to fork. Omit to start from base.
- `base`: The branch to start from when no Screen is named.
- `branch`: The new branch's name. Omit for a generated one.

## instance_remove

```text
Remove an Instance: its worktree is deleted, and its branch too when deleteBranch is true. It is refused when the branch has commits that are not pushed or merged, unless force is true; never force unless the person asked for that. Screens of the Instance stay on the canvas as their last snapshot, marked "Instance removed".
```

- `id`: The Instance's id, as canvas_read reports it on its Screens.
- `deleteBranch`: Also delete the branch.
- `force`: Remove it even though its branch has unpushed or unmerged commits.

## instance_status

```text
Report the Instances of this Repository, or one of them: its branch, worktree, state (creating, installing, starting, live, stopped, failed or removed), proxy and dev server ports, last error and the tail of its server log. Use it to see why a Screen is blank or failed before you change code.
```

- `id`: One Instance's id. Omit to list every Instance.

## instance_start

```text
Start an Instance's dev server now, on its own port, running the setup command first when the worktree has never been set up. It answers once the server is starting; read instance_status to see it go live or fail.
```

- `id`: The Instance's id.

## instance_stop

```text
Stop an Instance's dev server. Its Screens show their last snapshot until it runs again.
```

- `id`: The Instance's id.

## canvas_read

```text
In a Repository, a screen shows one route of one Instance at one viewport: it reports its instance (the Instance's id), route, title, w and h (the viewport), and dials when the person has set Parameters on it.
```

## canvas_write

```text
In a Repository you can also create a screen (props.instance is an Instance's id, props.route a path such as /settings, w and h the viewport) and update a screen's route, title, dials, w or h.
```

## preview_open

```text
In a Repository, shapeId may also name a Screen: the tab opens that Screen's route of its Instance through the Instance's proxy, at the Screen's viewport, and starts the Instance first when it is stopped.
```
