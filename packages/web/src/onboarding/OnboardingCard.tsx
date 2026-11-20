import { UnframedError, type ProviderStatuses } from "@unframed/contracts";
import { ONBOARDING_PROTOTYPE_PROMPT, onboardingSteps, projectSlug, type OnboardingState, type OnboardingStep, type StepStatus } from "@unframed/domain";
import { Check, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Input } from "~/components/ui/input";
import { messageOf } from "../agent/store.ts";
import { PROVIDERS, providerName, readyProviders } from "../agent/providers.ts";
import { useSlots } from "../chrome/slots.ts";
import { useActivation, useEngine, useSettings } from "../context.ts";
import { DEFAULT_PROJECT, useTabState } from "../project/activation.ts";
import { statusText } from "../settings/LocalAgents.tsx";
import { openSettings } from "../settings/settingsEvents.ts";
import { finishOnboarding, useOnboarding } from "./store.ts";

const TITLES: Record<OnboardingStep, string> = {
  agent: "Connect a local agent",
  project: "Name your first project",
  rail: "Open the agent panel",
  prototype: "Build a first prototype",
  generate: "Generate an image",
};

const useProviderStatuses = () => {
  const engine = useEngine();
  const [statuses, setStatuses] = useState<ProviderStatuses | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const check = useCallback(
    (refresh: boolean) => {
      setChecking(true);
      engine
        .call("providers.getStatuses", refresh ? { refresh: true } : {})
        .then(setStatuses, () => undefined)
        .finally(() => setChecking(false));
    },
    [engine],
  );
  useEffect(() => check(false), [check]);
  return { statuses, checking, check };
};

export const OnboardingCard = () => {
  const engine = useEngine();
  const state = useOnboarding(engine);
  if (state === undefined || state.done) return null;
  return <Card state={state} />;
};

const Card = ({ state }: { readonly state: OnboardingState }) => {
  const engine = useEngine();
  const activation = useActivation();
  const { active, loaded } = useTabState(activation);
  const providers = useProviderStatuses();
  const ready = readyProviders(providers.statuses);
  const steps = onboardingSteps(state, { agentReady: ready.length > 0, projectOpen: active !== undefined });
  const finished = steps.every((step) => step.status === "done");
  const current = steps.find((step) => step.status === "current")?.id;
  const [expanded, setExpanded] = useState<OnboardingStep | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const shown = expanded ?? current;
  const doneCount = steps.filter((step) => step.status === "done").length;

  useEffect(() => setExpanded(undefined), [current]);

  useEffect(() => {
    if (ready.length > 0) return;
    const recheck = () => providers.check(true);
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [ready.length, providers.check]);

  const close = async () => {
    if (active === undefined) {
      const created = await engine.call("projects.create", { name: DEFAULT_PROJECT }).catch(() => undefined);
      if (created !== undefined) await activation.activate(created.name);
    }
    await finishOnboarding(engine, state);
  };

  if (!loaded) return null;
  const centered = active === undefined;
  return (
    <section
      aria-label="Get started"
      data-testid="onboarding"
      data-centered={centered ? "" : undefined}
      className={`pointer-events-auto absolute z-[640] flex w-80 flex-col rounded-2xl border border-(--onboarding-border) bg-(--onboarding-surface) font-sans text-(--onboarding-foreground) shadow-lg shadow-(color:--onboarding-shadow) ${centered ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "top-12 right-3"}`}
    >
      <header className={`flex items-center gap-2 px-4 pt-3.5 ${collapsed ? "pb-3.5" : "pb-2"}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 text-sm font-medium">{finished ? "You’re set" : "Get started"}</h2>
          <p className="m-0 text-xs text-(--onboarding-description)" data-testid="onboarding-progress">
            {finished ? "Everything Unframed does starts from these." : `${doneCount} of ${steps.length} done`}
          </p>
        </div>
        {!centered && (
          <Button variant="ghost" size="icon-sm" aria-label={collapsed ? "Show the checklist" : "Hide the checklist"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
          </Button>
        )}
      </header>
      {!collapsed && (
        <>
          <ol className="m-0 flex list-none flex-col gap-0.5 px-2 pb-2">
            {steps.map((step) => (
              <Step key={step.id} id={step.id} status={step.status} open={shown === step.id} onToggle={() => setExpanded(shown === step.id ? (step.id === current ? undefined : current) : step.id)}>
                <StepBody id={step.id} status={step.status} providers={providers} />
              </Step>
            ))}
          </ol>
          <footer className="flex justify-end border-t border-(--onboarding-border) px-3 py-2">
            <Button variant={finished ? "default" : "ghost-muted"} size="sm" onClick={() => void close()}>
              {finished ? "Close" : "Skip the tour"}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
};

const Indicator = ({ status }: { readonly status: StepStatus }) =>
  status === "done" ? (
    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-(--onboarding-step-indicator-done) text-(--onboarding-surface)" aria-hidden>
      <Check className="size-3" />
    </span>
  ) : (
    <span
      className={`size-4 shrink-0 rounded-full border-2 ${status === "current" ? "border-(--onboarding-step-indicator-current)" : "border-(--onboarding-step-indicator)"}`}
      aria-hidden
    />
  );

const Step = ({ id, status, open, onToggle, children }: { readonly id: OnboardingStep; readonly status: StepStatus; readonly open: boolean; readonly onToggle: () => void; readonly children: ReactNode }) => (
  <li data-step={id} data-status={status} className={`rounded-lg ${open ? "bg-(--onboarding-step-surface-current)" : ""}`}>
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm text-(--onboarding-foreground) focus-visible:outline-2 focus-visible:outline-(--onboarding-step-indicator-current)">
        <Indicator status={status} />
        <span className={`min-w-0 flex-1 ${status === "done" ? "text-(--onboarding-description) line-through" : ""}`}>{TITLES[id]}</span>
        <span className="sr-only">{status === "done" ? "done" : status === "current" ? "next" : "to do"}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 px-2 pb-2.5 pl-8 text-xs text-(--onboarding-description)">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  </li>
);

const StepBody = ({ id, status, providers }: { readonly id: OnboardingStep; readonly status: StepStatus; readonly providers: ReturnType<typeof useProviderStatuses> }) => {
  const { agentControls } = useSlots();
  const activation = useActivation();
  const projectOpen = useTabState(activation).active !== undefined;
  const needsProject = !projectOpen && (id === "rail" || id === "prototype" || id === "generate");
  if (needsProject) return <p className="m-0">Name your first project to try this.</p>;
  switch (id) {
    case "agent":
      return <AgentStep providers={providers} />;
    case "project":
      return projectOpen ? <p className="m-0">Each project is a board, with its own folder for images, pages and clips.</p> : <ProjectStep />;
    case "rail":
      return (
        <>
          <p className="m-0">The agent works beside the canvas. It sees what you select, and every change it makes can be reverted.</p>
          {status !== "done" && (
            <Button size="sm" variant="outline" className="self-start" disabled={agentControls === undefined} onClick={() => agentControls?.open()}>
              Open the agent
            </Button>
          )}
        </>
      );
    case "prototype":
      return (
        <>
          <p className="m-0">Ask the agent for a page. It writes the HTML and places it on your board, where you can open it, edit it and keep iterating.</p>
          {status !== "done" && (
            <Button size="sm" variant="outline" className="self-start" disabled={agentControls === undefined} onClick={() => agentControls?.startChat(ONBOARDING_PROTOTYPE_PROMPT)}>
              Write the prompt for me
            </Button>
          )}
        </>
      );
    case "generate":
      return <GenerateStep done={status === "done"} />;
  }
};

const GenerateStep = ({ done }: { readonly done: boolean }) => {
  const hasKey = useSettings()?.hasKey === true;
  return (
    <>
      <p className="m-0">Write a prompt on the board, select it and press Generate for an image or a video. Generation is paid per run through OpenRouter, with your own key.</p>
      {!done && !hasKey && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => openSettings("generation")}>
          Add an OpenRouter key
        </Button>
      )}
    </>
  );
};

const AgentStep = ({ providers }: { readonly providers: ReturnType<typeof useProviderStatuses> }) => {
  const { statuses, checking, check } = providers;
  return (
    <>
      <p className="m-0">The agent runs on your own Claude or Codex plan, from this computer. Install one and sign in.</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="onboarding-providers">
        {PROVIDERS.map((provider) => {
          const status = statuses?.[provider];
          const dot =
            status === undefined
              ? "bg-(--onboarding-provider-dot-indicator)"
              : status.status === "ready"
                ? "bg-(--onboarding-provider-dot-indicator-active)"
                : "bg-(--onboarding-provider-dot-indicator-invalid)";
          return (
            <li key={provider} data-provider={provider} className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${dot}`} data-state={status?.status ?? "unchecked"} aria-hidden />
                <span className="font-medium text-(--onboarding-foreground)">{providerName(provider)}</span>
              </span>
              <span className="min-w-0">{status === undefined ? (checking ? "checking…" : "not checked yet") : statusText(status)}</span>
              {status?.status === "not_installed" && status.install !== "" && (
                <a href={status.install} target="_blank" rel="noopener noreferrer" className="self-start text-(--onboarding-link) underline-offset-4 hover:underline">
                  How to install
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-busy={checking || undefined} disabled={checking} onClick={() => check(true)}>
          <RefreshCw aria-hidden className={checking ? "animate-spin" : undefined} />
          Check again
        </Button>
        <Button size="sm" variant="ghost-muted" onClick={() => openSettings("agents")}>
          Settings
        </Button>
      </div>
    </>
  );
};

const ProjectStep = () => {
  const engine = useEngine();
  const activation = useActivation();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const slug = projectSlug(name);
    if (slug === "") return setProblem("Enter a project name.");
    setBusy(true);
    try {
      const created = await engine.call("projects.create", { name });
      await activation.activate(created.name);
    } catch (error) {
      setProblem(error instanceof UnframedError && error.code === "conflict" ? `A project named “${slug}” already exists.` : messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
      <p className="m-0">Each project is a board, with its own folder for images, pages and clips.</p>
      <div className="flex gap-2">
        <Input
          size="sm"
          aria-label="Project name"
          placeholder="My first project"
          autoFocus
          value={name}
          aria-invalid={problem !== undefined || undefined}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(undefined);
          }}
        />
        <Button size="sm" type="submit" disabled={busy}>
          Create
        </Button>
      </div>
      {problem !== undefined && (
        <p className="m-0 text-(--onboarding-error)" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
};
