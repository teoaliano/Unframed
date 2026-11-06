import { useState } from "react";
import { ProjectTab, ProjectTabs, ProjectTabsList } from "~/components/ui/project-tabs";
import { Demos, Section } from "../frame.tsx";

const Strip = ({ names, status }: { readonly names: ReadonlyArray<string>; readonly status?: Readonly<Record<string, "running" | "finished" | "dot">> }) => {
  const [active, setActive] = useState(names[0]);
  return (
    <div className="flex h-9 overflow-hidden rounded-xl border bg-background">
      <ProjectTabs value={active ?? null} onValueChange={(name) => setActive(String(name))}>
        <ProjectTabsList aria-label="Open projects">
          {names.map((name) => (
            <ProjectTab key={name} item={name} value={name} title={name} closeLabel={`Close ${name}`} {...(status?.[name] === undefined ? {} : { status: status[name] })}>
              <span className="min-w-0 truncate">{name}</span>
            </ProjectTab>
          ))}
        </ProjectTabsList>
      </ProjectTabs>
    </div>
  );
};

export default function ProjectTabsDemo() {
  return (
    <Demos>
      <Section title="The top bar's project tabs" flushTop>
        <Strip names={["default", "test"]} />
      </Section>
      <Section title="With status, and a long name that truncates" flushTop>
        <Strip names={["default", "running", "a-very-long-project-name"]} status={{ running: "running", default: "finished" }} />
      </Section>
    </Demos>
  );
}
