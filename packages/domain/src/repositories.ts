import type { ProjectKind, RepositoryStatus, StoredRepositoryStatus } from "@unframed/contracts";
import { projectSlug } from "./slug.ts";

export const REPOSITORY_FOLDER_PROMPT = "Choose a git repository to add";
export const NOT_A_FOLDER = "That folder does not exist.";
export const NOT_A_REPOSITORY = "That folder is not in a git repository.";
export const NO_GIT = "Unframed could not find git. Install git or Xcode's command line tools, then try again.";

export const projectKindOf = (value: unknown): ProjectKind => (value === "repository" ? "repository" : "whiteboard");

export const repositoryProjectName = (root: string): string => projectSlug(root.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? "");

export const gitRoots = (output: string): { readonly root: string; readonly gitCommonDir: string } | undefined => {
  const [root, gitCommonDir] = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return root === undefined || gitCommonDir === undefined ? undefined : { root, gitCommonDir };
};

export const hasUncommittedChanges = (porcelain: string): boolean => porcelain.trim() !== "";

export const repositoryStatus = (stored: StoredRepositoryStatus, rootExists: boolean): RepositoryStatus => (rootExists ? stored : "missing");

export const WHITEBOARD_ONLY_TOOLS: ReadonlySet<string> = new Set(["page_write", "motion_write"]);

export const noPagesInRepository = (project: string): string => `${project} is a Repository: there are no pages or motions to write there. Edit its code with your own file tools.`;

export const NO_SETUP_OPEN = "Setup is not running for this Repository.";
export const REJECTION_NEEDS_NOTE = "Say what is still wrong, so Setup can keep trying.";

export const SETUP_LOGIN_REQUESTED = "setup.login.requested";
export const SETUP_LOGIN_RESOLVED = "setup.login.resolved";
export const SETUP_PROPOSED = "setup.proposed";

export type SetupCard =
  | { readonly kind: "none" }
  | { readonly kind: "login"; readonly message: string }
  | { readonly kind: "proposed" };

interface SetupActivity {
  readonly kind: string;
  readonly summary: string;
  readonly turnId: string | null;
}

export const setupCard = (input: {
  readonly chatId: string;
  readonly setupChat: string | null | undefined;
  readonly activities: ReadonlyArray<SetupActivity>;
  readonly latestTurn: { readonly turnId: string; readonly state: string } | null;
}): SetupCard => {
  if (input.setupChat !== input.chatId || input.latestTurn === null) return { kind: "none" };
  const turn = input.latestTurn;
  const login = [...input.activities].reverse().find((activity) => activity.kind === SETUP_LOGIN_REQUESTED || activity.kind === SETUP_LOGIN_RESOLVED);
  if (turn.state === "running") return login?.kind === SETUP_LOGIN_REQUESTED && login.turnId === turn.turnId ? { kind: "login", message: login.summary } : { kind: "none" };
  return input.activities.some((activity) => activity.kind === SETUP_PROPOSED && activity.turnId === turn.turnId) ? { kind: "proposed" } : { kind: "none" };
};
