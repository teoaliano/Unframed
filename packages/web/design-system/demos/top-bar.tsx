import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { TopBar, type TopBarTab } from "~/components/ui/top-bar";
import logoUrl from "../../../../assets/brand/logo.svg?url";
import { Demos, Section } from "../frame.tsx";

type Platform = "macos" | "windows";

const Logo = () => (
  <span
    role="img"
    aria-label="Unframed"
    className="block size-6 shrink-0 bg-foreground"
    style={{ mask: `url("${logoUrl}") center / contain no-repeat`, WebkitMask: `url("${logoUrl}") center / contain no-repeat` }}
  />
);

/** One bar with its own tabs. The catalogue changes its tabs as a person would; it does not touch any project. */
const Bar = ({ platform, initial, initialActive }: { readonly platform: Platform; readonly initial: ReadonlyArray<TopBarTab>; readonly initialActive?: string }) => {
  const [tabs, setTabs] = useState<ReadonlyArray<TopBarTab>>(initial);
  const [active, setActive] = useState<string | undefined>(initialActive);
  const [count, setCount] = useState(1);
  const close = (name: string) => {
    const index = tabs.findIndex((tab) => tab.name === name);
    const rest = tabs.filter((tab) => tab.name !== name);
    setTabs(rest);
    if (active === name) setActive(rest[Math.min(index, rest.length - 1)]?.name);
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <TopBar
        platform={platform}
        tabs={tabs}
        active={active}
        logo={<Logo />}
        settings={
          <Button variant="ghost-muted" size="icon-sm" aria-label="Settings">
            <Settings />
          </Button>
        }
        newProject={
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="All projects"
            title="All projects"
            onClick={() => {
              const name = `project-${count + 1}`;
              setCount(count + 1);
              setTabs([...tabs, { name }]);
              setActive(name);
            }}
          >
            <Plus />
          </Button>
        }
        onActivate={setActive}
        onClose={close}
        onCloseAll={() => {
          setTabs([]);
          setActive(undefined);
        }}
        onRename={() => undefined}
        onDelete={() => undefined}
        onMove={(name, to) => {
          const from = tabs.findIndex((tab) => tab.name === name);
          const next = tabs.filter((tab) => tab.name !== name);
          next.splice(to, 0, tabs[from]!);
          setTabs(next);
        }}
      />
    </div>
  );
};

const MANY = ["spring-campaign-hero-shots", "product-packaging-explorations", "moodboard-warm-autumn", "client-review-round-two", "video-loops-experiment", "retail-window-mockups", "instagram-carousel-drafts", "press-kit-visuals", "brand-logo-variations", "newsletter-header-set", "tagline-options", "pricing-page-copy"];

/**
 * The project tab bar, one full-width bar. Switch between macOS and Windows: macOS has the
 * window controls at the start and Settings at the end, Windows mirrors them. Right-click a tab for
 * Close, Close all tabs, Rename project and Delete project. The bars are interactive; nothing is saved.
 */
export default function TopBarDemo() {
  const [platform, setPlatform] = useState<Platform>("macos");
  return (
    <Demos>
      <div className="flex items-center gap-2">
        <Button variant={platform === "macos" ? "default" : "outline"} aria-pressed={platform === "macos"} onClick={() => setPlatform("macos")}>
          macOS
        </Button>
        <Button variant={platform === "windows" ? "default" : "outline"} aria-pressed={platform === "windows"} onClick={() => setPlatform("windows")}>
          Windows
        </Button>
      </div>
      <Section title="One tab" flushTop>
        <Bar platform={platform} initial={[{ name: "default" }]} initialActive="default" />
      </Section>
      <Section title="Several tabs, with status" flushTop>
        <Bar
          platform={platform}
          initial={[{ name: "default" }, { name: "beta", status: "running" }, { name: "gamma", status: "finished" }, { name: "delta", status: "dot" }]}
          initialActive="gamma"
        />
      </Section>
      <Section title="Many tabs that truncate" flushTop>
        <Bar platform={platform} initial={MANY.map((name) => ({ name }))} initialActive="video-loops-experiment" />
      </Section>
    </Demos>
  );
}
