export type Theme = "light" | "dark";
export type ThemeChoice = "system" | Theme;

export const THEME_KEY = "app.theme";
export const THEME_CHOICES: ReadonlyArray<{ readonly value: ThemeChoice; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const themeChoiceOf = (value: unknown): ThemeChoice => (value === "light" || value === "dark" ? value : "system");

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CACHE_KEY = "unframed.theme";

const readCache = (): ThemeChoice => {
  try {
    return themeChoiceOf(localStorage.getItem(CACHE_KEY));
  } catch {
    return "system";
  }
};

const writeCache = (choice: ThemeChoice) => {
  try {
    localStorage.setItem(CACHE_KEY, choice);
  } catch {
    return;
  }
};

/** A token's colour as `#rrggbb`, drawn through a canvas so any CSS colour syntax (oklch, color-mix) reads the same. */
const hexOf = (token: string): string => {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.hidden = true;
  document.documentElement.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (!context) return color;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return `#${[...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

let choice: ThemeChoice = readCache();
let shown: Theme | undefined;
const listeners = new Set<(theme: Theme) => void>();

const systemTheme = (): Theme => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");

/**
 * Sets `data-unframed-theme` on `<html>` to the theme shown: the person's choice, or the
 * system's when they chose System. The desktop shell reads the attribute, and in the same
 * frame two colours in the formats it has always parsed (spec 01): `--unframed-text-secondary`
 * on `<html>` as hex, and the opaque body background, which computes to `rgb()`. The kit's
 * tokens are oklch and color-mix, which the shell's native colour calls may not accept.
 */
const apply = () => {
  const theme = choice === "system" ? systemTheme() : choice;
  const root = document.documentElement;
  root.setAttribute("data-unframed-theme", theme);
  root.style.setProperty("--unframed-text-secondary", hexOf("--text-muted"));
  document.body.style.backgroundColor = hexOf("--surface-background");
  if (theme === shown) return;
  shown = theme;
  for (const listener of listeners) listener(theme);
};

/** Shows the chosen theme and keeps it live with the system preference. Answers a stop function. */
export const followTheme = (): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);
  apply();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
};

export const themeChoice = (): ThemeChoice => choice;

/** Shows `next` at once and remembers it on this device, so the next launch paints in it before the engine answers. */
export const setThemeChoice = (next: ThemeChoice) => {
  writeCache(next);
  if (next === choice) return;
  choice = next;
  apply();
};

export const shownTheme = (): Theme => shown ?? (choice === "system" ? systemTheme() : choice);

/** Calls `listener` with the theme shown now and on every change. Answers a stop function. */
export const onThemeShown = (listener: (theme: Theme) => void): (() => void) => {
  listeners.add(listener);
  listener(shownTheme());
  return () => listeners.delete(listener);
};
