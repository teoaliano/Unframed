/**
 * The Kit table (spec 19): the groups on the left, the search, the tokens as rows with one column
 * per mode, the row menu, the mode menus, and Add token and Add mode.
 */
import { applyKitOps, cssName, TOKEN_TYPES, type Kit, type KitOp, type Token, type TokenType, type TokenValue } from "@unframed/domain";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../chrome/ui.tsx";
import { keepEscapeInField, ValueCell } from "./KitCells.tsx";

/** The value a new token of each type starts with, so it is valid before the person edits it. */
export const STARTING_VALUE: Record<TokenType, TokenValue> = {
  color: "#000000",
  dimension: "0px",
  fontFamily: "sans-serif",
  fontWeight: 400,
  textStyle: { fontFamily: "sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: "1.5", letterSpacing: "0px" },
  shadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
  duration: "200ms",
  easing: "power2.out",
};

/** The value a token shows in one mode: its own, else the default mode's. */
export const valueIn = (token: Token, mode: string, kit: Kit): TokenValue | undefined => token.value ?? token.values?.[mode] ?? token.values?.[kit.modes[0]!];

const groupOf = (path: string): string => path.split("/")[0]!;

/** The artifacts that use a token or mode, named in a tooltip: at most ten titles, then the rest. */
export const usedByLabel = (ids: ReadonlyArray<string>, titleOf: (id: string) => string): string => {
  const titles = ids.slice(0, 10).map(titleOf);
  const rest = ids.length - titles.length;
  return rest > 0 ? [...titles, `and ${rest} more`].join("\n") : titles.join("\n");
};

/** Which artifact shapes use each token path and each mode (kit.usage). */
export interface KitUsageCounts {
  readonly tokens: Readonly<Record<string, readonly string[]>>;
  readonly modes: Readonly<Record<string, readonly string[]>>;
}

export interface KitTableProps {
  readonly kit: Kit;
  readonly usage: KitUsageCounts;
  readonly apply: (ops: ReadonlyArray<KitOp>) => string | undefined;
  readonly titleOf: (id: string) => string;
  readonly onAskDeleteToken: (path: string) => void;
  readonly onAskDeleteMode: (mode: string) => void;
}

export const KitTable = (props: KitTableProps) => {
  const { kit, apply, titleOf, onAskDeleteToken, onAskDeleteMode } = props;
  const usage = props.usage;
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingMode, setAddingMode] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [renamingMode, setRenamingMode] = useState<string>();
  const [problem, setProblem] = useState<string>();

  const groups = [...new Set(kit.tokens.map((token) => groupOf(token.path)))].map((name) => ({
    name,
    count: kit.tokens.filter((token) => groupOf(token.path) === name).length,
  }));
  const needle = query.trim();
  const shown = kit.tokens.filter(
    (token) => (group === "All" || groupOf(token.path) === group) && (needle === "" || token.path.includes(needle) || cssName(token.path).includes(needle)),
  );

  /** A refusal stays under its field; a commit that worked closes the field. */
  const finish = (refusal: string | undefined, close: () => void): string | undefined => {
    if (refusal === undefined) close();
    return refusal;
  };

  const commit = (ops: ReadonlyArray<KitOp>): string | undefined => {
    const check = applyKitOps(kit, ops);
    if (!check.ok) return check.refusal;
    return apply(ops);
  };

  const setValue = (token: Token, mode: string, value: TokenValue): string | undefined => {
    if (token.value !== undefined) return commit([{ op: "setToken", path: token.path, type: token.type, value }]);
    return commit([{ op: "setToken", path: token.path, type: token.type, values: { ...token.values, [mode]: value } }]);
  };

  const onePerMode = (token: Token, perMode: boolean) => {
    const base = valueIn(token, kit.modes[0]!, kit);
    if (base === undefined) return;
    if (perMode) commit([{ op: "setToken", path: token.path, type: token.type, values: Object.fromEntries(kit.modes.map((mode) => [mode, base])) }]);
    else commit([{ op: "setToken", path: token.path, type: token.type, value: base }]);
  };

  const addToken = (path: string, type: TokenType) => {
    const refusal = commit([{ op: "setToken", path, type, value: STARTING_VALUE[type] }]);
    setProblem(refusal);
    if (refusal === undefined) setAdding(false);
  };

  return (
    <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)]">
      <nav aria-label="Token groups" className="grid content-start gap-1">
        <GroupButton name="All" active={group === "All"} onClick={() => setGroup("All")} />
        {groups.map((item) => (
          <GroupButton key={item.name} name={item.name} count={item.count} active={group === item.name} onClick={() => setGroup(item.name)} />
        ))}
      </nav>
      <div className="grid min-w-0 gap-3">
        <Input type="search" placeholder="Search tokens…" aria-label="Search tokens" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 font-medium">Token</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Type</th>
                {kit.modes.map((mode, index) => (
                  <th scope="col" key={mode} className="px-2 py-1.5 font-medium">
                    {renamingMode === mode ? (
                      <NameField label={`Mode name ${mode}`} initial={mode} onCancel={() => setRenamingMode(undefined)} onCommit={(name) => finish(commit([{ op: "renameMode", name: mode, to: name }]), () => setRenamingMode(undefined))} />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {mode}
                        {index === 0 && <span className="text-muted-foreground/70">default</span>}
                        <ModeMenu
                          mode={mode}
                          isDefault={index === 0}
                          onRename={() => setRenamingMode(mode)}
                          onDefault={() => commit([{ op: "setDefaultMode", name: mode }])}
                          onDuplicate={() => commit([{ op: "addMode", name: `${mode}-copy`, copyFrom: mode }])}
                          onDelete={() => onAskDeleteMode(mode)}
                        />
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {addingMode ? (
                    <NameField label="Mode name" initial="" onCancel={() => setAddingMode(false)} onCommit={(name) => finish(commit([{ op: "addMode", name }]), () => setAddingMode(false))} />
                  ) : (
                    <Button variant="ghost" size="xs" onClick={() => setAddingMode(true)}>
                      Add mode
                    </Button>
                  )}
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">Used by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((token) => {
                const oneValue = token.value !== undefined;
                const former = token.formerNames ?? [];
                const users = usage.tokens[token.path] ?? [];
                return (
                  <tr key={token.path} data-token={token.path} className="border-t align-top">
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-1">
                        <span className="grid min-w-0">
                          {renaming === token.path ? (
                            <NameField label={`Rename ${token.path}`} initial={token.path} onCancel={() => setRenaming(undefined)} onCommit={(to) => finish(commit([{ op: "renameToken", path: token.path, to }]), () => setRenaming(undefined))} />
                          ) : (
                            <span className="truncate">{token.path}</span>
                          )}
                          <span className="truncate font-mono text-xs text-muted-foreground">{cssName(token.path)}</span>
                          {former.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              Also answers to {former.join(", ")}{" "}
                              {former.map((name) => (
                                <Button key={name} variant="link" size="xs" onClick={() => commit([{ op: "forgetFormerName", path: token.path, cssName: name }])}>
                                  Forget {name}
                                </Button>
                              ))}
                            </span>
                          )}
                        </span>
                        <RowMenu
                          token={token}
                          oneValue={oneValue}
                          hasFormer={former.length > 0}
                          onePerMode={(perMode) => onePerMode(token, perMode)}
                          onRename={() => setRenaming(token.path)}
                          onForget={() => former.forEach((name) => commit([{ op: "forgetFormerName", path: token.path, cssName: name }]))}
                          onDelete={() => onAskDeleteToken(token.path)}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{token.type}</td>
                    {oneValue ? (
                      <td className="px-2 py-2" colSpan={kit.modes.length} data-mode="all">
                        <ValueCell token={token} label={token.path} value={token.value} onCommit={(next) => setValue(token, kit.modes[0]!, next)} />
                      </td>
                    ) : (
                      kit.modes.map((mode) => (
                        <td key={mode} className="px-2 py-2" data-mode={mode}>
                          <ValueCell token={token} label={`${token.path} ${mode}`} value={valueIn(token, mode, kit)} onCommit={(next) => setValue(token, mode, next)} />
                        </td>
                      ))
                    )}
                    <td className="px-2 py-2" />
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {users.length > 0 && (
                        <Tip label={<span className="whitespace-pre-line">{usedByLabel(users, titleOf)}</span>}>
                          <span>{users.length}</span>
                        </Tip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {adding ? <AddToken initialPath={group === "All" ? "" : `${group}/`} onAdd={addToken} onCancel={() => setAdding(false)} /> : <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>Add token</Button>}
        {problem !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
};

const GroupButton = ({ name, count, active, onClick }: { readonly name: string; readonly count?: number; readonly active: boolean; readonly onClick: () => void }) => (
  <Button variant={active ? "secondary" : "ghost"} size="sm" className="justify-start" aria-label={count === undefined ? name : `${name} ${count}`} aria-pressed={active} onClick={onClick}>
    {name}
    {count !== undefined && <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>}
  </Button>
);

/** A name typed in place: Enter commits, Escape or leaving the field cancels; a refusal shows under it. */
const NameField = ({ label, initial, onCommit, onCancel }: { readonly label: string; readonly initial: string; readonly onCommit: (name: string) => string | undefined; readonly onCancel: () => void }) => {
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string>();
  return (
    <span className="grid gap-1">
      <Input
        size="sm"
        font="mono"
        aria-label={label}
        autoFocus
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") setProblem(onCommit(text.trim()));
          if (event.key === "Escape") {
            keepEscapeInField(event);
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
      {problem !== undefined && (
        <span role="alert" className="text-xs text-destructive">
          {problem}
        </span>
      )}
    </span>
  );
};

const ModeMenu = ({ mode, isDefault, onRename, onDefault, onDuplicate, onDelete }: { readonly mode: string; readonly isDefault: boolean; readonly onRename: () => void; readonly onDefault: () => void; readonly onDuplicate: () => void; readonly onDelete: () => void }) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Button ref={trigger} variant="ghost" size="icon-xs" aria-label={`Mode options ${mode}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        …
      </Button>
      <MenuPopup anchor={trigger} side="bottom" align="start">
        <MenuItem onClick={onRename}>Rename mode</MenuItem>
        {!isDefault && <MenuItem onClick={onDefault}>Make default</MenuItem>}
        <MenuItem onClick={onDuplicate}>Duplicate mode</MenuItem>
        <MenuItem onClick={onDelete}>Delete mode</MenuItem>
      </MenuPopup>
    </Menu>
  );
};

const RowMenu = ({ token, oneValue, hasFormer, onePerMode, onRename, onForget, onDelete }: { readonly token: Token; readonly oneValue: boolean; readonly hasFormer: boolean; readonly onePerMode: (perMode: boolean) => void; readonly onRename: () => void; readonly onForget: () => void; readonly onDelete: () => void }) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Button ref={trigger} variant="ghost" size="icon-xs" aria-label={`Token options ${token.path}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        …
      </Button>
      <MenuPopup anchor={trigger} side="bottom" align="end">
        {oneValue ? <MenuItem onClick={() => onePerMode(true)}>A value per mode</MenuItem> : <MenuItem onClick={() => onePerMode(false)}>One value for all modes</MenuItem>}
        <MenuItem onClick={onRename}>Rename</MenuItem>
        {hasFormer && <MenuItem onClick={onForget}>Forget old names</MenuItem>}
        <MenuItem onClick={onDelete}>Delete</MenuItem>
      </MenuPopup>
    </Menu>
  );
};

const AddToken = ({ initialPath, onAdd, onCancel }: { readonly initialPath: string; readonly onAdd: (path: string, type: TokenType) => void; readonly onCancel: () => void }) => {
  const [path, setPath] = useState(initialPath);
  const [type, setType] = useState<TokenType>("color");
  const items = TOKEN_TYPES.map((value) => ({ value, label: value }));
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        keepEscapeInField(event);
        onCancel();
      }}
    >
      <Input
        aria-label="Token path"
        value={path}
        onChange={(event) => setPath(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onAdd(path.trim(), type);
        }}
        className="max-w-64"
        font="mono"
      />
      <Select items={items} value={type} onValueChange={(next) => next && setType(next as TokenType)}>
        <SelectTrigger aria-label="Token type">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
};
