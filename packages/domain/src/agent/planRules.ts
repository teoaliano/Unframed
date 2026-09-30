import type { Chat, ProposedPlan } from "./chatModel.ts";
import { IMPLEMENT_PLAN_PROMPT } from "./prompts.ts";

/** Proposed plans as the card and Implement read them (t3code's `proposedPlan.ts`). */

const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/;

/** The plan's first heading, if it has one. */
export const planTitle = (plan: string): string | undefined => {
  const heading = plan.match(new RegExp(HEADING.source, "m"))?.[1]?.trim();
  return heading ? heading : undefined;
};

/** What Implement sends: the prefix, then the trimmed plan. */
export const implementPlanText = (plan: string): string => IMPLEMENT_PLAN_PROMPT.replace("<plan>", () => plan.trim());

/** The title of a new chat that implements the plan. */
export const implementPlanTitle = (plan: string): string => {
  const title = planTitle(plan);
  return title === undefined ? "Implement plan" : `Implement ${title}`;
};

/** "Download as markdown" names the file after the title. */
export const planFileName = (plan: string): string => {
  const slug = (planTitle(plan) ?? "plan")
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "plan" : slug}.md`;
};

/** The plan as the card shows it: without the heading the card uses as its title, nor a leading Summary heading. */
export const shownPlan = (plan: string): string => {
  const lines = plan.trimEnd().split(/\r?\n/);
  const rest = lines[0] !== undefined && HEADING.test(lines[0]) ? lines.slice(1) : [...lines];
  const dropBlank = () => {
    while (rest[0] !== undefined && rest[0].trim() === "") rest.shift();
  };
  dropBlank();
  if (rest[0]?.match(HEADING)?.[1]?.trim().toLowerCase() === "summary") {
    rest.shift();
    dropBlank();
  }
  return rest.join("\n");
};

/** A plan over 900 characters or 20 lines shows a preview first. */
export const planCollapses = (plan: string): boolean => plan.length > 900 || plan.split("\n").length > 20;

/** The preview: the first 10 lines that carry text, then "..." when there is more. */
export const collapsedPlanPreview = (plan: string, lines = 10): string => {
  const preview: string[] = [];
  let shown = 0;
  let more = false;
  for (const line of shownPlan(plan).split(/\r?\n/).map((each) => each.trimEnd())) {
    const visible = line.trim() !== "";
    if (visible && shown >= lines) {
      more = true;
      break;
    }
    preview.push(line);
    if (visible) shown += 1;
  }
  while (preview.length > 0 && preview.at(-1)!.trim() === "") preview.pop();
  if (preview.length === 0) return planTitle(plan) ?? "Plan preview unavailable.";
  if (more) preview.push("", "...");
  return preview.join("\n");
};

/** The plan Implement acts on: the latest turn's newest plan, else the newest; none once implemented. */
export const actionablePlan = (chat: Pick<Chat, "latestTurn" | "proposedPlans">): ProposedPlan | undefined => {
  const byUpdate = [...chat.proposedPlans].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  const latestTurnId = chat.latestTurn?.turnId;
  const plan = byUpdate.filter((known) => latestTurnId !== undefined && known.turnId === latestTurnId).at(-1) ?? byUpdate.at(-1);
  return plan && plan.implementedAt === null ? plan : undefined;
};
