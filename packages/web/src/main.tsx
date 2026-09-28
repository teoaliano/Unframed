import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connectEngine } from "./rpc/engine.ts";
import { followSystemTheme } from "./theme.ts";
import "./theme.css";

followSystemTheme();

// The web mounts into #root only and never touches the other children of <body>, so an
// element the desktop shell appends (its update pill) survives. It never sets
// document.title either: the shell's override must stick.
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App engine={connectEngine()} />
    </StrictMode>,
  );
}
