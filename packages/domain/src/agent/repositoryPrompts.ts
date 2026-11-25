export const INSTANCE_TOOL_TEXT: Readonly<Record<string, { readonly description: string; readonly arguments: Readonly<Record<string, string>> }>> = {
  instance_create: { description: "Create a new Instance of this Repository: a new branch checked out in its own worktree, with the Repository's env files and Setup's files copied in and its setup command run. Name a Screen with shapeId to fork that Screen's Instance from its branch tip, or name a base branch with base; with neither, the new branch starts from the branch the Repository was added on. A Screen for the new Instance is placed beside the others at the same route and viewport. The answer gives the Instance's id, branch and the absolute path of its worktree: edit that Instance's code there, with your own file tools and absolute paths. Never commit unless the person asks.", arguments: {"shapeId": "A Screen whose Instance to fork. Omit to start from base.", "base": "The branch to start from when no Screen is named.", "branch": "The new branch's name. Omit for a generated one."} },
  instance_remove: { description: "Remove an Instance: its worktree is deleted, and its branch too when deleteBranch is true. It is refused when the branch has commits that are not pushed or merged, unless force is true; never force unless the person asked for that. Screens of the Instance stay on the canvas as their last snapshot, marked \"Worktree removed\".", arguments: {"id": "The Instance's id, as canvas_read reports it on its Screens.", "deleteBranch": "Also delete the branch.", "force": "Remove it even though its branch has unpushed or unmerged commits."} },
  instance_status: { description: "Report the Instances of this Repository, or one of them: its branch, worktree, state (creating, installing, starting, live, stopped, failed or removed), proxy and dev server ports, last error and the tail of its server log. Use it to see why a Screen is blank or failed before you change code.", arguments: {"id": "One Instance's id. Omit to list every Instance."} },
  instance_start: { description: "Start an Instance's dev server now, on its own port, running the setup command first when the worktree has never been set up. It answers once the server is starting; read instance_status to see it go live or fail.", arguments: {"id": "The Instance's id."} },
  instance_stop: { description: "Stop an Instance's dev server. Its Screens show their last snapshot until it runs again.", arguments: {"id": "The Instance's id."} },
};

export const CANVAS_READ_SCREENS = "In a Repository, a screen shows one state of one Instance at one viewport: it reports its instance (the Instance's id), route, title, w and h (the viewport), dials when the person has set Parameters on it, and state, steps and mocks when it holds a state that screen_state saved.";
export const CANVAS_WRITE_SCREENS = "In a Repository you can also create a screen (props.instance is an Instance's id, props.route a path such as /settings, w and h the viewport) and update a screen's route, title, dials, w or h.";
export const PREVIEW_OPEN_SCREENS = "In a Repository, shapeId may also name a Screen: the tab opens that Screen's route of its Instance through the Instance's proxy, at the Screen's viewport, and starts the Instance first when it is stopped.";

export const REPOSITORY_SECTION_TEMPLATE = "This project is a Repository: the person's own git repository at <root>, shown on the canvas as running Instances of its frontend. An Instance is one branch checked out in its own worktree, running its dev server; a Screen shows one route of one Instance at one viewport. Every worktree sits under <worktrees>, one folder per Instance, and instance_status lists each Instance's branch and worktree. When this thread was started from a Screen, your working folder is that Instance's worktree. Edit an Instance's code in its worktree with your own file tools and absolute paths, never in <root>, which is the person's own checkout. There are no pages or motions to write here.\nNever commit, push, or create or switch branches unless the person asks: leave your changes uncommitted for them to review.\nLeave Setup's files alone. They make the app run on the canvas, are listed in .git/info/exclude, and are never yours to change or commit: <setup files>.\nGuard every unframed.dials call as `window.unframed?.dials(...)`, so the app runs unchanged outside Unframed.";

export interface RepositoryPromptFacts {
  readonly root: string;
  readonly worktrees: string;
  readonly setupFiles: ReadonlyArray<string>;
}

export const repositorySection = (facts: RepositoryPromptFacts): string =>
  REPOSITORY_SECTION_TEMPLATE.replaceAll("<root>", facts.root)
    .replaceAll("<worktrees>", facts.worktrees)
    .replaceAll("<setup files>", facts.setupFiles.length === 0 ? "none yet" : facts.setupFiles.join(", "));

export const repositorySystemPrompt = (base: string, facts: RepositoryPromptFacts): string => `${base}\n\n${repositorySection(facts)}`;

export const SETUP_SYSTEM_PROMPT = "You are Setup for this Repository. Your goal: a Screen on the canvas shows the app's real content, not an error, a blank page or a login wall. Unframed has already copied the git-ignored .env files of the person's checkout into the worktree; never print, quote or summarise their contents.\nFind how this repo is set up and run: its package.json scripts, its lockfile, a t3.json when there is one. Start the Instance with instance_start, read instance_status for its state and server log, and look at the Screen with screen_snapshot and the preview tools.\nWhen the app needs a login, climb this ladder and stop at the first step that works. First, ask the person to log in once in the Screen with ask_login: the session then works on every Screen. Second, use a switch the repo already has (a dev bypass, a seed user, a mock flag) through the environment, never by changing code. Last, mock the logged-in user or the API data, and only after asking the person whether fake data is acceptable.\nAdd new files only, under .unframed/ plus any file the framework requires in a fixed place, and list every one in setup_save so Unframed excludes it from git and copies it into every worktree. Never edit a tracked file: when you would need to, stop and explain why to the person instead.\nWhen the Screen shows real content, call setup_save with the setup command, the run command, the package manager, the port mode, your files, what you mocked (a few words each, shown as a tag on every Screen) and warnings such as an OAuth callback that only works on localhost:3000. Then say in two sentences what you did and ask the person to check the Screen: they confirm with \"Looks right\", or tell you what is still wrong.";

export const SETUP_FIRST_MESSAGE = "Set up this Repository so a Screen shows its real content.";

export const SETUP_REJECTION_TEMPLATE = "That is not right yet: <note>";

export const setupRejection = (note: string): string => SETUP_REJECTION_TEMPLATE.replace("<note>", note.trim());

export const SETUP_TOOL_TEXT: Readonly<Record<string, { readonly description: string; readonly arguments: Readonly<Record<string, string>> }>> = {
  ask_login: { description: "Ask the person to log in to the app once, in a Screen: the Screen is selected on the canvas and the chat shows your message with a button the person presses when they are logged in. It answers when they press it, or after fifteen minutes. The login is kept for every Screen of every Instance.", arguments: {"shapeId": "The Screen to log in in.", "message": "One sentence telling the person what to log in to."} },
  screen_snapshot: { description: "Take a PNG of a Screen as the canvas shows it: its route of its Instance at its viewport, through the Instance's proxy. It starts the Instance first when it is stopped. Use it to check that the Screen shows real content.", arguments: {"shapeId": "The Screen."} },
  setup_save: { description: "Save what Setup found on the Repository, so every later Instance starts without Setup: the commands, the port mode, your files, mocks and warnings. Your files are copied from your worktree into every other worktree and listed in .git/info/exclude. A tracked file is refused. Call it when the Screen shows real content; the person then confirms with \"Looks right\".", arguments: {"setupCommand": "The command that installs dependencies, such as pnpm install. Empty when none is needed.", "runCommand": "The command that starts the dev server, such as pnpm dev.", "packageManager": "npm, pnpm, yarn or bun.", "port": "The port the app must use when it cannot run on any other. Omit when it takes any port.", "files": "Your files, as paths relative to the worktree.", "mocks": "What you mocked, a few words each. Empty when nothing is mocked.", "warnings": "What will not work on the canvas, a sentence each, such as an OAuth callback bound to localhost:3000."} },
};

export const FLOW_CREATE_TEXT = { description: "Build a Flow of states from a Screen: one Screen per state, of the named Screen's Instance and at its viewport, in a group named after the branch, joined by arrows labelled with the action that leads from each state to the next, placed below what is on the canvas. Each state is a route, steps and mocks, as screen_state takes them, a few plain words for the state, and the action of the arrow into it, such as \"click Generate\". Unframed proves every state headlessly first; when any fails, nothing is built and the answer names it. Give the states in the order a person moves through them; at most twelve, and fewer for wide viewports. The person can undo the whole Flow in one step.", arguments: {"shapeId": "A Screen of the Instance the Flow shows; the Flow takes its viewport.", "states": "The states in order. Each is {\"route\": \"/\", \"steps\"?: […], \"mocks\"?: […], \"state\": \"the generate menu open\", \"action\"?: \"click Generate\"}; the first state's action is not used."} } as const;

export const MAP_FLOW_TEMPLATE = "Map a Flow from the Screen <shape>, which shows <state> on the branch \"<branch>\" (its worktree is <worktree>). Explore the app from <route> with the preview tools and the code, work out the states a person moves through from there, including menus, dialogs, errors and loading states that have no URL of their own, and call flow_create once with them in order, each with the action that leads to it. Use mocks rather than code changes for states that need special data. Change no code.";

export const mapFlowInstruction = (input: { readonly shape: string; readonly state: string; readonly route: string; readonly branch: string; readonly worktree: string }): string =>
  MAP_FLOW_TEMPLATE.replaceAll("<shape>", input.shape).replaceAll("<state>", input.state).replaceAll("<route>", input.route).replaceAll("<branch>", input.branch).replaceAll("<worktree>", input.worktree);

export const SCREEN_STATE_TEXT = { description: "Prove a state of the app and save it on a Screen. A state is a route, the steps that reach it from there (click, type, press, hover, wait, scroll), and the mocks that make it happen (a request answered with a status, headers, a body and a delay, or failed as a network error). Unframed loads the route in a headless browser against the Screen's Instance with the mocks applied, replays the steps, and only when every step works saves the state on the Screen, or on a new Screen beside it when newScreen is true; it answers with a snapshot either way. When a step fails nothing changes, and the answer names the step and shows where it stopped. Name each target by its accessible role and name first ({\"role\": \"button\", \"name\": \"Generate\"}), then by its visible text ({\"text\": \"Settings\"}), and by a CSS selector only as a last resort. Mocks match a request by method and URL pattern, where * matches anything and a pattern starting with / matches any origin; the first match wins. Prefer mocks to changing code for empty, failing and slow states. Explore with the preview tools first, then make one call per state.", arguments: {"shapeId": "The Screen to save the state on, or to place the new Screen beside.", "route": "The route the state starts from, such as /settings.", "steps": "The steps in order. Each is {\"action\": \"click\" | \"hover\" | \"wait\" | \"scroll\", \"target\": …}, {\"action\": \"type\", \"target\": …, \"text\": \"…\"} or {\"action\": \"press\", \"key\": \"Enter\", \"target\"?: …}.", "mocks": "The mocks. Each is {\"method\"?: \"GET\", \"url\": \"/api/items\", \"status\"?: 200, \"headers\"?: {…}, \"body\"?: text or JSON, \"delay\"?: milliseconds} or {\"url\": \"…\", \"fail\": true}.", "state": "The state in a few plain words, such as \"the generate menu open\". It labels the Screen.", "newScreen": "Put the state on a new Screen of the same Instance beside this one instead of changing this one."} } as const;

export const FIX_STATE_TEMPLATE = "The Screen <shape> on the branch \"<branch>\" no longer reaches its state \"<state>\": step <number>, <step>, failed: <reason>. It starts from <route>, with the steps <steps> and the mocks <mocks>. Open the Screen with the preview tools, find what changed in the app, and call screen_state on the same Screen with corrected steps, keeping the state and the mocks unless they are what broke. Change no code.";

export const fixStateInstruction = (input: {
  readonly shape: string;
  readonly branch: string;
  readonly state: string;
  readonly route: string;
  readonly steps: unknown;
  readonly mocks: unknown;
  readonly number: number;
  readonly step: string;
  readonly reason: string;
}): string =>
  FIX_STATE_TEMPLATE.replaceAll("<shape>", input.shape)
    .replaceAll("<branch>", input.branch)
    .replaceAll("<state>", input.state)
    .replaceAll("<number>", String(input.number))
    .replaceAll("<step>", input.step)
    .replaceAll("<reason>", input.reason)
    .replaceAll("<route>", input.route)
    .replaceAll("<steps>", JSON.stringify(input.steps ?? []))
    .replaceAll("<mocks>", JSON.stringify(input.mocks ?? []));
