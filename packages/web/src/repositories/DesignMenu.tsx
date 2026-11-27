import { ancestorsOf, elementKind, type LayerTree } from "@unframed/domain";
import { useEffect, useState } from "react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "~/components/ui/menu";
import type { EditSession, ResolvedSource } from "../artifacts/editor/editSession.ts";
import type { DesignCommand } from "./designKeys.ts";

export interface MenuAt {
  readonly x: number;
  readonly y: number;
  readonly id: string;
}

const MENU_TRIGGER = "design-layer-menu";

const treeOf = (session: EditSession): LayerTree => {
  const elements = session.tree?.elements ?? [];
  return {
    parentOf: (id) => elements.find((element) => element.id === id)?.parent ?? null,
    childrenOf: (id) => elements.filter((element) => element.parent === id).map((element) => element.id),
  };
};

const nameOf = (session: EditSession, id: string): string => {
  const report = session.reports[id];
  const node = session.tree?.elements.find((element) => element.id === id);
  return report?.instance ?? report?.slot ?? elementKind(report?.tag ?? node?.tag ?? "element");
};

const whereOf = (found: ResolvedSource | null | undefined): string => {
  const source = found?.source;
  if (source === null || source === undefined) return "";
  const file = source.file.split("/").pop() ?? source.file;
  return `${file}:${source.line}`;
};

export const DesignMenu = ({ at, session, onClose, onCommand }: { readonly at: MenuAt | undefined; readonly session: EditSession; readonly onClose: () => void; readonly onCommand: (command: DesignCommand) => void }) => {
  const [found, setFound] = useState<Readonly<Record<string, ResolvedSource | null>>>({});
  const chain = at === undefined ? [] : [at.id, ...ancestorsOf(at.id, treeOf(session))];
  const chainKey = chain.join(" ");
  useEffect(() => {
    if (chainKey === "") return;
    let live = true;
    for (const id of chainKey.split(" ")) void session.resolve(id).then((resolved) => live && setFound((previous) => ({ ...previous, [id]: resolved })));
    return () => {
      live = false;
    };
  }, [chainKey]);
  const anchor = at === undefined ? undefined : { getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }) };
  const run = (command: DesignCommand) => {
    onCommand(command);
    onClose();
  };
  return (
    <Menu modal={false} triggerId={MENU_TRIGGER} open={at !== undefined} onOpenChange={(open) => !open && onClose()}>
      <MenuTrigger id={MENU_TRIGGER} nativeButton={false} render={<span hidden />} />
      {at !== undefined && (
        <MenuPopup anchor={anchor} side="bottom" align="start" sideOffset={2} aria-label="Layer actions" data-testid="design-menu">
          <MenuSub>
            <MenuSubTrigger>Select layer</MenuSubTrigger>
            <MenuSubPopup aria-label="Select layer">
              {chain.map((id) => {
                const resolved = found[id];
                const owner = resolved?.owner ?? null;
                const name = nameOf(session, id);
                return (
                  <MenuItem key={id} data-layer={id} onClick={() => session.setSelection([id])}>
                    <span className="min-w-0 truncate">{owner === null || owner === name ? name : `${name} · in ${owner}`}</span>
                    <MenuShortcut>{whereOf(resolved)}</MenuShortcut>
                  </MenuItem>
                );
              })}
            </MenuSubPopup>
          </MenuSub>
          <MenuItem onClick={() => run({ kind: "parent" })}>
            Select parent
            <MenuShortcut>⇧↵</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run({ kind: "children" })}>
            Select children
            <MenuShortcut>↵</MenuShortcut>
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => run({ kind: "duplicate" })}>
            Duplicate
            <MenuShortcut>⌘D</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run({ kind: "move", by: 1 })}>
            Bring forward
            <MenuShortcut>⌘]</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run({ kind: "move", by: -1 })}>
            Send backward
            <MenuShortcut>⌘[</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run({ kind: "wrap" })}>
            Wrap in a frame
            <MenuShortcut>⌥⌘G</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run({ kind: "hide" })}>
            Hide
            <MenuShortcut>⇧⌘H</MenuShortcut>
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => run({ kind: "delete" })}>
            Delete
            <MenuShortcut>⌫</MenuShortcut>
          </MenuItem>
        </MenuPopup>
      )}
    </Menu>
  );
};
