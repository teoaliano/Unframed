export type Theme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

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

/**
 * Sets `data-unframed-theme` on `<html>` to the theme currently shown and keeps it live
 * with the system preference. The desktop shell reads the attribute, and in the same frame
 * two colours in the formats it has always parsed (spec 01): `--unframed-text-secondary`
 * on `<html>` as hex, and the opaque body background, which computes to `rgb()`. The kit's
 * tokens are oklch and color-mix, which the shell's native colour calls may not accept.
 * Answers a stop function.
 */
export const followSystemTheme = (): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);
  const apply = () => {
    const theme: Theme = query.matches ? "dark" : "light";
    const root = document.documentElement;
    root.setAttribute("data-unframed-theme", theme);
    root.style.setProperty("--unframed-text-secondary", hexOf("--muted-foreground"));
    document.body.style.backgroundColor = hexOf("--background");
  };
  apply();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
};
