import { Film, Image, MessageSquare, Search, Settings, Sparkles, Type } from "lucide-react";
import type { ReactNode } from "react";
import { AutocompleteEmpty } from "~/components/ui/autocomplete";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandFooter,
  CommandFooterAction,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "~/components/ui/command";
import { Kbd } from "~/components/ui/kbd";
import { Demos, Row, Section } from "../frame.tsx";

const ICONS: Record<string, ReactNode> = {
  "New image prompt": <Image />,
  "New video prompt": <Film />,
  "New text prompt": <Type />,
  "Ask Claude about the selection": <Sparkles />,
  "Open chat history": <MessageSquare />,
  "Open settings": <Settings />,
};

const SHORTCUTS: Record<string, string> = {
  "New image prompt": "⌘I",
  "Ask Claude about the selection": "⌘K",
  "Open settings": "⌘,",
};

const GROUPS = [
  { value: "Create", items: ["New image prompt", "New video prompt", "New text prompt"] },
  { value: "Agent", items: ["Ask Claude about the selection", "Open chat history"] },
  { value: "App", items: ["Open settings"] },
];

const Palette = ({ activeItem, autoFocus = false }: { readonly activeItem?: string; readonly autoFocus?: boolean }) => (
  <Command items={GROUPS}>
    <CommandInput autoFocus={autoFocus} aria-label="Search commands" placeholder="Search commands" />
    <CommandPanel>
      <AutocompleteEmpty>No command matches.</AutocompleteEmpty>
      <CommandList>
        {(group: (typeof GROUPS)[number]) => (
          <CommandGroup key={group.value} items={group.items}>
            <CommandGroupLabel>{group.value}</CommandGroupLabel>
            <CommandCollection>
              {(item: string) => (
                <CommandItem key={item} value={item} {...(activeItem === undefined ? {} : { active: item === activeItem })}>
                  {ICONS[item]}
                  {item}
                  {SHORTCUTS[item] && <CommandShortcut>{SHORTCUTS[item]}</CommandShortcut>}
                </CommandItem>
              )}
            </CommandCollection>
          </CommandGroup>
        )}
      </CommandList>
    </CommandPanel>
    <CommandFooter>
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd>
        Run
      </span>
      <CommandFooterAction>All shortcuts</CommandFooterAction>
    </CommandFooter>
  </Command>
);

export default function CommandDemo() {
  return (
    <Demos>
      <Section title="Dialog">
        <Row label="trigger">
          <CommandDialog>
            <CommandDialogTrigger render={<Button variant="outline" />}>
              <Search />
              Open command palette
            </CommandDialogTrigger>
            <CommandDialogPopup aria-label="Command palette">
              <Palette autoFocus />
            </CommandDialogPopup>
          </CommandDialog>
        </Row>
      </Section>
      <Section title="Inline">
        <Row label="primitive highlight">
          <div className="w-full max-w-xl rounded-2xl border">
            <Palette />
          </div>
        </Row>
        <Row label="active item">
          <div className="w-full max-w-xl rounded-2xl border">
            <Palette activeItem="Ask Claude about the selection" />
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
