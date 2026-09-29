import type { ReactNode } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Demos, Row, Section } from "../frame.tsx";

const PROMPTS = [
  "A lighthouse at dusk, 35mm film",
  "Neon koi pond, top-down, rain",
  "Terraced rice fields at sunrise",
  "Brutalist library interior, soft light",
  "Paper-cut forest, layered depth",
  "Macro shot of frost on a leaf",
  "Retro rocket on a desert launchpad",
  "Watercolour map of an island town",
  "Isometric greenhouse, morning haze",
  "Slow dolly through a night market",
  "Studio portrait, rim light, teal backdrop",
  "Clay figurine of a fox, tilt-shift",
];

const List = () => (
  <ul className="m-0 flex list-none flex-col gap-1 p-2 text-sm">
    {PROMPTS.map((prompt) => (
      <li key={prompt} className="rounded-md px-2 py-1">
        {prompt}
      </li>
    ))}
  </ul>
);

const Box = ({ children }: { readonly children: ReactNode }) => <div className="h-40 w-72 rounded-lg border">{children}</div>;

export default function ScrollAreaDemo() {
  return (
    <Demos>
      <Section title="Options">
        <Row label="default">
          <Box>
            <ScrollArea>
              <List />
            </ScrollArea>
          </Box>
        </Row>
        <Row label="scrollFade">
          <Box>
            <ScrollArea scrollFade>
              <List />
            </ScrollArea>
          </Box>
        </Row>
        <Row label="scrollbarGutter">
          <Box>
            <ScrollArea scrollbarGutter>
              <List />
            </ScrollArea>
          </Box>
        </Row>
        <Row label="hideScrollbars">
          <Box>
            <ScrollArea hideScrollbars>
              <List />
            </ScrollArea>
          </Box>
        </Row>
        <Row label="radius none">
          <Box>
            <ScrollArea radius="none">
              <List />
            </ScrollArea>
          </Box>
        </Row>
      </Section>
      <Section title="Overflow">
        <Row label="horizontal">
          <div className="h-24 w-72 rounded-lg border">
            <ScrollArea>
              <div className="flex w-max gap-2 p-2">
                {PROMPTS.map((prompt) => (
                  <span key={prompt} className="flex size-20 shrink-0 items-end rounded-md bg-muted p-1.5 text-muted-foreground text-xs">
                    {prompt.split(",")[0]}
                  </span>
                ))}
              </div>
            </ScrollArea>
          </div>
        </Row>
        <Row label="no overflow">
          <Box>
            <ScrollArea scrollFade>
              <p className="m-0 p-3 text-sm">Short content does not scroll, so no fade or bar shows.</p>
            </ScrollArea>
          </Box>
        </Row>
      </Section>
    </Demos>
  );
}
