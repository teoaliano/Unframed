import { ArrowUp, ChevronDown } from "lucide-react";
import { Spinner } from "~/components/ui/spinner";
import { MessageAction, SendArrow, StopSquare } from "~/chrome/MessageAction";
import { Demos, Row, Section } from "../frame.tsx";

export default function MessageActionDemo() {
  return (
    <Demos>
      <Section title="Round">
        <Row label="send">
          <MessageAction tone="send" aria-label="Send">
            <SendArrow />
          </MessageAction>
          <MessageAction tone="send" aria-label="Send" disabled>
            <SendArrow />
          </MessageAction>
        </Row>
        <Row label="stop">
          <MessageAction tone="stop" aria-label="Stop generation">
            <StopSquare />
          </MessageAction>
        </Row>
        <Row label="stop, then send">
          <div className="flex items-center gap-2">
            <MessageAction tone="stop" aria-label="Stop generation">
              <StopSquare />
            </MessageAction>
            <MessageAction tone="send" aria-label="Queue message">
              <SendArrow />
            </MessageAction>
          </div>
        </Row>
      </Section>
      <Section title="Pill">
        <Row label="pill">
          <MessageAction tone="pill">
            <ArrowUp aria-hidden />
            Generate 4 images
          </MessageAction>
          <MessageAction tone="pill">Submit answer</MessageAction>
          <MessageAction tone="pill">Refine</MessageAction>
        </Row>
        <Row label="sending">
          <MessageAction tone="pill" aria-busy data-sending="true" disabled>
            <Spinner aria-hidden />
            Generating…
          </MessageAction>
        </Row>
        <Row label="disabled">
          <MessageAction tone="pill" disabled>
            <ArrowUp aria-hidden />
            Generate
          </MessageAction>
        </Row>
      </Section>
      <Section title="Split pill">
        <Row label="pillStart, pillEnd">
          <div className="flex items-center">
            <MessageAction tone="pillStart">Implement</MessageAction>
            <MessageAction tone="pillEnd" aria-label="Implementation actions">
              <ChevronDown aria-hidden />
            </MessageAction>
          </div>
        </Row>
        <Row label="disabled">
          <div className="flex items-center">
            <MessageAction tone="pillStart" disabled>
              Sending...
            </MessageAction>
            <MessageAction tone="pillEnd" aria-label="Implementation actions" disabled>
              <ChevronDown aria-hidden />
            </MessageAction>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
