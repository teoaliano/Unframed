import type { AgentProvider, ProviderStatus } from "@unframed/contracts";
import { searchSlashCommands, type SlashItem } from "@unframed/domain";
import { providerName } from "../providers.ts";
import type { MenuItem } from "./ComposerMenu.tsx";

export type BuiltIn = "model" | "plan" | "default";

export type CommandItem = SlashItem & MenuItem;

export const BUILT_INS: ReadonlyArray<SlashItem & { readonly name: BuiltIn }> = [
  { kind: "builtin", name: "model", description: "Switch response model for this chat" },
  { kind: "builtin", name: "plan", description: "Switch this chat into plan mode" },
  { kind: "builtin", name: "default", description: "Switch this chat back to normal build mode" },
];

const skillItems = (status: ProviderStatus | undefined, provider: AgentProvider, alone: boolean): CommandItem[] =>
  (status?.skills ?? []).map((skill) => ({
    kind: "skill",
    name: skill.name,
    description: skill.description !== "" ? skill.description : alone ? "Run provider skill" : `${providerName(provider)} skill`,
    key: `skill:${skill.name}`,
    label: alone ? `$${skill.name}` : `/skill:${skill.name}`,
    badge: providerName(provider),
  }));

/**
 * What `/` offers at the start of the draft: the built-ins, the provider's own commands
 * (`/compact` only when it is the whole draft with no attachments) and its skills, ranked
 * by the query.
 */
export const slashItems = (input: {
  readonly query: string;
  readonly status: ProviderStatus | undefined;
  readonly provider: AgentProvider;
  /** The draft holds nothing but this command, and no attachments. */
  readonly wholeDraft: boolean;
  /** Plan mode is on: `/plan` and `/default` are offered. */
  readonly planMode: boolean;
}): CommandItem[] => {
  const builtIns: CommandItem[] = BUILT_INS.filter((item) => input.planMode || item.name === "model").map((item) => ({ ...item, key: `builtin:${item.name}`, label: `/${item.name}` }));
  const commands: CommandItem[] = (input.status?.commands ?? [])
    .filter((command) => command.name !== "compact" || input.wholeDraft)
    .map((command) => ({
      kind: "provider",
      name: command.name,
      description: command.description !== "" ? command.description : "Run provider command",
      key: `provider:${command.name}`,
      label: `/${command.name}`,
    }));
  return searchSlashCommands(input.query, [...builtIns, ...commands, ...skillItems(input.status, input.provider, false)]);
};

/** What `$` offers: the provider's skills alone. */
export const skillMenuItems = (query: string, status: ProviderStatus | undefined, provider: AgentProvider): CommandItem[] =>
  searchSlashCommands(query, skillItems(status, provider, true));
