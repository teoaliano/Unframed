import { Copy, Download, Ellipsis, ImagePlus, Pencil, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { SelectButton } from "~/components/ui/select";
import { Demos, Row, Section } from "../frame.tsx";

export default function MenuDemo() {
  return (
    <Demos>
      <Section title="Items">
        <Row label="item variants">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Shape actions</MenuTrigger>
            <MenuPopup align="start">
              <MenuItem>
                <Copy />
                Duplicate
                <MenuShortcut>⌘D</MenuShortcut>
              </MenuItem>
              <MenuItem>
                <Download />
                Download
              </MenuItem>
              <MenuItem disabled>
                <Wand2 />
                Upscale (image only)
              </MenuItem>
              <MenuItem inset>Rename</MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive">
                <Trash2 />
                Delete
                <MenuShortcut>⌫</MenuShortcut>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="ghost variant">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Quick actions</MenuTrigger>
            <MenuPopup align="start">
              <MenuItem variant="ghost">
                <Sparkles />
                Generate variations
              </MenuItem>
              <MenuItem variant="ghost">
                <Pencil />
                Edit prompt
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="density touch">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Touch rows</MenuTrigger>
            <MenuPopup align="start">
              <MenuItem density="touch">
                <ImagePlus />
                <MenuItemLabel>Add reference image</MenuItemLabel>
              </MenuItem>
              <MenuItem density="touch">
                <MenuItemLabel>A very long label that truncates once the menu reaches its edge</MenuItemLabel>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="groups">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Canvas</MenuTrigger>
            <MenuPopup align="start">
              <MenuGroup>
                <MenuGroupLabel>Selection</MenuGroupLabel>
                <MenuItem>Send to agent</MenuItem>
                <MenuItem>Generate from selection</MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel inset>Canvas</MenuGroupLabel>
                <MenuItem inset>Zoom to fit</MenuItem>
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </Row>
      </Section>
      <Section title="Checkbox and radio">
        <Row label="checkbox">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>View</MenuTrigger>
            <MenuPopup align="start">
              <MenuCheckboxItem defaultChecked>Show prompts</MenuCheckboxItem>
              <MenuCheckboxItem>Show costs</MenuCheckboxItem>
              <MenuCheckboxItem disabled>Show seeds</MenuCheckboxItem>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="checkbox switch">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Agent options</MenuTrigger>
            <MenuPopup align="start">
              <MenuCheckboxItem variant="switch" defaultChecked>
                Ask before editing files
              </MenuCheckboxItem>
              <MenuCheckboxItem variant="switch">Plan first</MenuCheckboxItem>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="radio">
          <Menu>
            <MenuTrigger render={<SelectButton className="w-40" />}>16:9</MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup defaultValue="16:9">
                <MenuRadioItem value="1:1">Square, 1:1</MenuRadioItem>
                <MenuRadioItem value="16:9">Landscape, 16:9</MenuRadioItem>
                <MenuRadioItem value="9:16">Portrait, 9:16</MenuRadioItem>
                <MenuRadioItem value="4:3" disabled>
                  Classic, 4:3
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="radio, indicator">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Agent</MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup defaultValue="claude">
                <MenuRadioItem value="claude">
                  <span className="flex items-center justify-between gap-4">
                    Claude
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
                <MenuRadioItem value="codex">
                  <span className="flex items-center justify-between gap-4">
                    Codex
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        </Row>
      </Section>
      <Section title="Submenu and trigger">
        <Row label="submenu">
          <Menu>
            <MenuTrigger render={<Button variant="outline" />}>Export</MenuTrigger>
            <MenuPopup align="start">
              <MenuItem>Copy image</MenuItem>
              <MenuSub>
                <MenuSubTrigger>
                  <Download />
                  Download as
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuItem>PNG</MenuItem>
                  <MenuItem>JPEG</MenuItem>
                  <MenuItem>WebP</MenuItem>
                </MenuSubPopup>
              </MenuSub>
              <MenuSub>
                <MenuSubTrigger inset>Share</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuItem>Copy link</MenuItem>
                </MenuSubPopup>
              </MenuSub>
              <MenuSub>
                <MenuSubTrigger disabled>Send to (no apps)</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuItem>None</MenuItem>
                </MenuSubPopup>
              </MenuSub>
            </MenuPopup>
          </Menu>
        </Row>
        <Row label="icon trigger, side">
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
              <Ellipsis />
            </MenuTrigger>
            <MenuPopup side="right" align="start">
              <MenuItem>Rename chat</MenuItem>
              <MenuItem variant="destructive">Archive chat</MenuItem>
            </MenuPopup>
          </Menu>
          <Menu>
            <MenuTrigger render={<Button variant="outline" disabled />}>Disabled trigger</MenuTrigger>
            <MenuPopup>
              <MenuItem>Unreachable</MenuItem>
            </MenuPopup>
          </Menu>
        </Row>
      </Section>
    </Demos>
  );
}
