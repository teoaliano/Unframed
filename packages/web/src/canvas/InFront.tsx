import { BottomRight } from "../chrome/AddMenu.tsx";
import { Tether } from "../generate/overlays.tsx";
import { SelectionToolbar } from "../generate/SelectionToolbar.tsx";
import { LibraryHost } from "../library/LibraryHost.tsx";
import { MentionMenu } from "./MentionMenu.tsx";

/** Everything Unframed draws in front of the canvas, inside tldraw's container. */
export const InFront = () => (
  <>
    <Tether />
    <MentionMenu />
    <SelectionToolbar />
    <BottomRight />
    <LibraryHost />
  </>
);
