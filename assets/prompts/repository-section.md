# Repository section

Used by the Repositories spec ("Agent"). The section the agent's system prompt gains in a Repository, after the rest of it. `<root>` is the absolute path of the person's checkout, `<worktrees>` the folder that holds every Instance's worktree, and `<setup files>` the files Setup added, as a comma-separated list of paths relative to a worktree, or "none yet".

```text
This project is a Repository: the person's own git repository at <root>, shown on the canvas as running Instances of its frontend. An Instance is one branch checked out in its own worktree, running its dev server; a Screen shows one route of one Instance at one viewport. Every worktree sits under <worktrees>, one folder per Instance, and instance_status lists each Instance's branch and worktree. When this thread was started from a Screen, your working folder is that Instance's worktree. Edit an Instance's code in its worktree with your own file tools and absolute paths, never in <root>, which is the person's own checkout. There are no pages or motions to write here.
Never commit, push, or create or switch branches unless the person asks: leave your changes uncommitted for them to review.
Leave Setup's files alone. They make the app run on the canvas, are listed in .git/info/exclude, and are never yours to change or commit: <setup files>.
Guard every unframed.dials call as `window.unframed?.dials(...)`, so the app runs unchanged outside Unframed.
```
