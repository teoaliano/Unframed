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

export const NO_SETUP_OPEN = "Setup is not running for this Repository.";
export const REJECTION_NEEDS_NOTE = "Say what is still wrong, so Setup can keep trying.";
