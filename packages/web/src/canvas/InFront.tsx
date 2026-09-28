import { BottomRight } from "../chrome/AddMenu.tsx";
import { MentionMenu } from "./MentionMenu.tsx";

/** Everything Unframed draws in front of the canvas, inside tldraw's container. */
export const InFront = () => (
  <>
    <MentionMenu />
    <BottomRight />
  </>
);
