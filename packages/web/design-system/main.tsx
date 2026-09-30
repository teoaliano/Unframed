/**
 * The design-system catalogue's entry. The dev server serves it at /design-system/; the
 * production build's only input is the app's index.html, so neither the published bundle
 * nor the desktop app carries it.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { followSystemTheme } from "~/theme/theme.ts";
import "~/theme/theme.css";
import { Catalogue } from "./Catalogue.tsx";

followSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider position="bottom-left">
      <Catalogue />
    </ToastProvider>
  </StrictMode>,
);
