import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Demos, Row, Section } from "../frame.tsx";

export default function LabelDemo() {
  return (
    <Demos>
      <Section title="Label">
        <Row label="for an input">
          <div className="flex w-72 flex-col gap-1.5">
            <Label htmlFor="label-demo-name">Canvas name</Label>
            <Input id="label-demo-name" defaultValue="Spring campaign" />
          </div>
        </Row>
        <Row label="wrapping a control">
          <Label>
            <Checkbox defaultChecked />
            Save generations to the library
          </Label>
        </Row>
        <Row label="disabled control">
          <Label>
            <Checkbox disabled />
            Upscale after generating
          </Label>
        </Row>
        <Row label="render span">
          <Label render={<span />}>Follow-up behavior</Label>
        </Row>
        <Row label="long text">
          <div className="w-72">
            <Label>Ask before the agent edits files outside the canvas folder</Label>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
