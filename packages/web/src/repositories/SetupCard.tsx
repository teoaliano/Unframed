import { setupCard, type Chat } from "@unframed/domain";
import { useState } from "react";
import { useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useEngine } from "../context.ts";
import { useFeature } from "../features.ts";
import { repositoryState } from "./store.ts";
import { usePendingWork } from "./pendingWork.ts";

const CARD_CLASS = "flex flex-col gap-2.5 rounded-3xl border border-(--setup-card-border)/(--setup-card-border-opacity) bg-(--setup-card-surface)/(--setup-card-surface-opacity) p-4";

export const SetupCard = ({ project, chat }: { readonly project: string; readonly chat: Chat }) => {
  const on = useFeature("repositories");
  const engine = useEngine();
  const repository = useValue("setup repository", () => repositoryState(project).repository.get(), [project]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const { busy, problem, run } = usePendingWork();
  const card = setupCard({ chatId: chat.id, setupChat: repository?.setupChat, activities: chat.activities, latestTurn: chat.latestTurn });
  if (!on || card.kind === "none") return null;

  const act = (work: () => Promise<unknown>) =>
    run(async () => {
      await work();
      setRejecting(false);
      setNote("");
    });
  const verdict = (accepted: boolean) =>
    act(async () => {
      const answer = await engine.call("repositories.setupVerdict", { project, accepted, ...(accepted ? {} : { note }) });
      repositoryState(project).repository.set(answer.repository);
    });

  if (card.kind === "login") {
    return (
      <section className={CARD_CLASS} data-testid="setup-card" data-kind="login">
        <h3 className="m-0 text-sm font-medium text-(--setup-card-title)">Log in once in the Screen</h3>
        <p className="m-0 text-sm text-(--setup-card-body)">{card.message}</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void act(() => engine.call("repositories.confirmLogin", { project }))}>
            I'm logged in
          </Button>
        </div>
        {problem !== undefined && <p role="alert" className="m-0 text-xs text-(--setup-card-error)">{problem}</p>}
      </section>
    );
  }

  return (
    <section className={CARD_CLASS} data-testid="setup-card" data-kind="proposed">
      <h3 className="m-0 text-sm font-medium text-(--setup-card-title)">Does the Screen show your app?</h3>
      <p className="m-0 text-sm text-(--setup-card-body)">Setup thinks it is done. Check the Screen, then confirm, or say what is still wrong and Setup keeps going.</p>
      {rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void verdict(false);
          }}
        >
          <Textarea aria-label="What is still wrong" placeholder="What is still wrong?" value={note} onChange={(event) => setNote(event.currentTarget.value)} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || note.trim() === ""}>
              Send to Setup
            </Button>
            <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void verdict(true)}>
            Looks right
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            Not yet
          </Button>
        </div>
      )}
      {problem !== undefined && <p role="alert" className="m-0 text-xs text-(--setup-card-error)">{problem}</p>}
    </section>
  );
};
