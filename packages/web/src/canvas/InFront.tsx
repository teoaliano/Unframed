import { AgentHost } from "../agent/AgentHost.tsx";
import { useEffect } from "react";
import { ToolbarEnd } from "../chrome/AddMenu.tsx";
import { registerSlot } from "../chrome/slots.ts";
import { Tether } from "../generate/overlays.tsx";
import { SelectionToolbar } from "../generate/SelectionToolbar.tsx";
import { KitHost } from "../kits/KitHost.tsx";
import { LibraryHost } from "../library/LibraryHost.tsx";
import { MentionMenu } from "./MentionMenu.tsx";
import { ToolTray } from "./ToolTray.tsx";
import { ArtifactsHost } from "../artifacts/ArtifactsHost.tsx";
import { NodeChrome } from "../nodes/NodeChrome.tsx";
import { CommentsHost } from "../comments/CommentsHost.tsx";
import { useFeature } from "../features.ts";

export const InFront = () => {
  useEffect(() => registerSlot("toolbarEnd", ToolbarEnd), []);
  const nodes = useFeature("nodes");
  return (
  <>
    <Tether />
    <CommentsHost />
    {nodes && <NodeChrome />}
    <MentionMenu />
    <SelectionToolbar />
    <ToolTray />
    <LibraryHost />
    <KitHost />
    <AgentHost />
    <ArtifactsHost />
  </>
  );
};
