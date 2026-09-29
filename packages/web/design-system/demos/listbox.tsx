import { FileText, Image, ListTodo, Sparkles } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { listboxPopupClass, listboxRowClass } from "~/chrome/listbox";
import { Demos, Row, Section } from "../frame.tsx";

const MENTIONS = [
  { ref: "p1", preview: "A foggy harbour at dawn, fishing boats" },
  { ref: "p2", preview: "Same harbour at night, neon reflections" },
  { ref: "g1", preview: "Moodboard: coastal towns" },
  { ref: "p3", preview: "Product spin on a white sweep" },
];

const COMMANDS = [
  { key: "plan", icon: <ListTodo className="size-3.5" />, label: "/plan", description: "Plan before building", badge: undefined },
  { key: "page", icon: <FileText className="size-3.5" />, label: "/page", description: "Make a page artifact from the selection", badge: "New" },
  { key: "image", icon: <Image className="size-3.5" />, label: "/image", description: "Describe images for Generate", badge: undefined },
  { key: "skill", icon: <Sparkles className="size-3.5" />, label: "/brand-voice", description: "", badge: "Skill" },
];

const THREADS = [
  { title: "Landing page for the harbour series", line: "Added a hero with the dawn image" },
  { title: "Storyboard the product spin", line: "Six shots, two seconds each" },
];

export default function ListboxDemo() {
  return (
    <Demos>
      <Section title="Mention menu">
        <Row label="row 2 highlighted">
          <div role="listbox" aria-label="Mentions" className={`${listboxPopupClass} max-h-[168px] w-[260px]`}>
            {MENTIONS.map((row, index) => (
              <div key={row.ref} role="option" aria-selected={index === 1} data-highlighted={index === 1 ? "" : undefined} className={`${listboxRowClass} whitespace-nowrap`}>
                <span className="shrink-0 text-primary">@{row.ref}</span>
                <span className="min-w-0 truncate text-muted-foreground">{row.preview}</span>
              </div>
            ))}
          </div>
        </Row>
      </Section>
      <Section title="Slash menu">
        <Row label="first highlighted">
          <div role="listbox" aria-label="Commands" className={`${listboxPopupClass} max-h-65 w-96`}>
            {COMMANDS.map((item, index) => (
              <div key={item.key} role="option" aria-selected={index === 0} data-highlighted={index === 0 ? "" : undefined} className={listboxRowClass}>
                <span className="inline-flex shrink-0 text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 max-w-[45%] shrink-0 truncate text-xs font-medium">{item.label}</span>
                {item.description !== "" && <span className="min-w-0 flex-1 truncate text-left text-xs text-secondary-label">{item.description}</span>}
                {item.badge !== undefined && (
                  <span className="ms-auto">
                    <Badge variant="secondary">{item.badge}</Badge>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Row>
        <Row label="empty">
          <div role="listbox" aria-label="Commands" className={`${listboxPopupClass} w-96`}>
            <p className="m-0 px-2 py-1.5 text-xs text-secondary-label">No commands match “/xyz”.</p>
          </div>
        </Row>
      </Section>
      <Section title="Chat search">
        <Row label="two-line rows">
          <div role="listbox" aria-label="Search results" className={`${listboxPopupClass} max-h-80 w-80`}>
            {THREADS.map((thread, index) => (
              <div key={thread.title} role="option" aria-selected={index === 0} data-highlighted={index === 0 ? "" : undefined} className={`${listboxRowClass} flex-col items-start gap-0.5`}>
                <span className="truncate font-medium">{thread.title}</span>
                <span className="truncate text-xs text-muted-foreground">{thread.line}</span>
              </div>
            ))}
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
