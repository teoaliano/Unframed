const MAX_SLUG_LENGTH = 40;

/**
 * A project name as a folder name. The slug is also what keeps a name inside the
 * output folder, so every path that takes a project name slugs it first. An empty
 * result means the name is refused.
 */
export const projectSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
