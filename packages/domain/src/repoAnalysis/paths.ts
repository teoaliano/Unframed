export const ANALYSIS_MAX_FILE_BYTES = 256_000;
export const ANALYSIS_MAX_FILES = 5000;

const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", ".next", ".git", ".unframed", "coverage", ".svelte-kit", ".nuxt", ".output", ".turbo", ".vercel", "out"]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|css|scss|pcss)$/;
const CONFIG = /^(?:package\.json|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|components\.json)$/;
const SKIPPED_FILE = /(?:\.d\.ts|\.(?:test|spec|stories|story)\.[a-z]+)$/;

export const analysedPath = (path: string): boolean => {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => SKIPPED_FOLDERS.has(part) || part === "__tests__" || part === "__mocks__")) return false;
  if (CONFIG.test(name)) return true;
  if (SKIPPED_FILE.test(name)) return false;
  return SOURCE.test(name);
};
