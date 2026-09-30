import { Check } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { InlineButton } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { labelHue, type Hue } from "~/chrome/hue";
import { Demos, Row, Section } from "../frame.tsx";

const MODELS: ReadonlyArray<{ readonly id: string; readonly provider: string; readonly hue: Hue; readonly output: string; readonly released: string; readonly current?: boolean }> = [
  { id: "gemini-2.5-flash-image", provider: "Google", hue: "blue", output: "Image", released: "Aug 2025", current: true },
  { id: "gpt-image-1", provider: "OpenAI", hue: "green", output: "Image", released: "Apr 2025" },
  { id: "seedream-4", provider: "ByteDance", hue: "purple", output: "Image", released: "Sep 2025" },
  { id: "veo-3", provider: "Google", hue: "blue", output: "Video", released: "May 2025" },
];

export default function TableDemo() {
  return (
    <Demos>
      <Section title="Model list">
        <Row label="header, body">
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead>
                    <span className="block text-right">Released</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MODELS.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <InlineButton tone="picker">
                        <span className={model.current ? "font-bold" : undefined}>{model.id}</span>
                        {model.current && <Check aria-label="Current model" className="size-3.5" />}
                      </InlineButton>
                    </TableCell>
                    <TableCell>
                      <Badge variant="label" style={labelHue(model.hue)}>
                        {model.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>{model.output}</TableCell>
                    <TableCell>
                      <span className="block text-right tabular-nums">{model.released}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Row>
      </Section>
      <Section title="Row states">
        <Row label="selected, checkbox">
          <div className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox aria-label="Select all" />
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow data-state="selected">
                  <TableCell>
                    <Checkbox defaultChecked aria-label="Select harbour.png" />
                  </TableCell>
                  <TableCell>harbour.png</TableCell>
                  <TableCell>2.4 MB</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <Checkbox aria-label="Select spin.mp4" />
                  </TableCell>
                  <TableCell>spin.mp4</TableCell>
                  <TableCell>18 MB</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
