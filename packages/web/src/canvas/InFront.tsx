import { AgentHost } from "../agent/AgentHost.tsx";
import { useEffect } from "react";
import { ToolbarEnd } from "../chrome/AddMenu.tsx";
import { registerSlot } from "../chrome/slots.ts";
import { Tether } from "../generate/overlays.tsx";
import { SelectionToolbar } from "../generate/SelectionToolbar.tsx";
import { LibraryHost } from "../library/LibraryHost.tsx";
import { MentionMenu } from "./MentionMenu.tsx";
import { ArtifactsHost } from "../artifacts/ArtifactsHost.tsx";

/** Everything Unframed draws in front of the canvas, inside tldraw's container. */
export const InFront = () => {
  useEffect(() => registerSlot("toolbarEnd", ToolbarEnd), []);
  return (
  <>
    <Tether />
    <MentionMenu />
    <SelectionToolbar />
    <LibraryHost />
    <AgentHost />
    <ArtifactsHost />
  </>
  );
};
