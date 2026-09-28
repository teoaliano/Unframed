const MAX_SLUG_LENGTH = 40;

/**
 * A project name as a folder name. The slug is also what keeps a name inside the
 * output folder, so every path that takes a project name slugs it first. The caller
 * refuses a name whose slug is empty.
 */
export const projectSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
