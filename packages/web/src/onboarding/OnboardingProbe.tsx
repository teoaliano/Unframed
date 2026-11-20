import { useEffect } from "react";
import { useEditor, useValue } from "tldraw";
import { useChatClient, useRailUi } from "../agent/store.ts";
import { useCanvasProject, useEngine } from "../context.ts";
import { seeStep, useOnboarding } from "./store.ts";

export const OnboardingProbe = () => {
  const engine = useEngine();
  const state = useOnboarding(engine);
  if (state === undefined || state.done) return null;
  return <Watch state={state} />;
};

const Watch = ({ state }: { readonly state: NonNullable<ReturnType<typeof useOnboarding>> }) => {
  const engine = useEngine();
  const editor = useEditor();
  const client = useChatClient(engine, useCanvasProject());
  const railOpen = useRailUi(client).open;
  const hasPage = useValue("onboarding page", () => editor.getCurrentPageShapes().some((shape) => shape.type === "page"), [editor]);
  const hasMedia = useValue(
    "onboarding media",
    () => editor.getCurrentPageShapes().some((shape) => (shape.type === "image" || shape.type === "video") && (shape.props as { assetId?: unknown }).assetId != null),
    [editor],
  );
  useEffect(() => {
    if (railOpen) void seeStep(engine, state, "rail");
  }, [engine, state, railOpen]);
  useEffect(() => {
    if (hasPage) void seeStep(engine, state, "prototype");
  }, [engine, state, hasPage]);
  useEffect(() => {
    if (hasMedia) void seeStep(engine, state, "generate");
  }, [engine, state, hasMedia]);
  return null;
};
