export type Theme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Sets `data-unframed-theme` on `<html>` to the theme currently shown and keeps it live
 * with the system preference. The desktop shell reads the attribute. Answers a stop
 * function.
 */
export const followSystemTheme = (): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);
  const apply = () => {
    const theme: Theme = query.matches ? "dark" : "light";
    document.documentElement.setAttribute("data-unframed-theme", theme);
  };
  apply();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
};
