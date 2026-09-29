import { ImageOff, Library, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { Demos, Row, Section } from "../frame.tsx";

const SIZES = ["compact", "default", "hero"] as const;

export default function EmptyDemo() {
  return (
    <Demos>
      <Section title="Sizes">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Empty size={size}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Library />
                </EmptyMedia>
                <EmptyTitle>Your library is empty</EmptyTitle>
                <EmptyDescription>Images and videos you generate land here.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm">
                  <Plus />
                  New prompt
                </Button>
              </EmptyContent>
            </Empty>
          </Row>
        ))}
      </Section>
      <Section title="Media">
        <Row label="icon">
          <Empty size="compact">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageOff />
              </EmptyMedia>
              <EmptyTitle>No images match</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </Row>
        <Row label="default">
          <Empty size="compact">
            <EmptyHeader>
              <EmptyMedia>
                <ImageOff className="size-8 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No images match</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </Row>
        <Row label="none">
          <Empty size="compact">
            <EmptyHeader>
              <EmptyTitle>No chats yet</EmptyTitle>
              <EmptyDescription>
                Select shapes and press Agent to start one. <a href="#empty">How the agent works</a>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Row>
      </Section>
    </Demos>
  );
}
