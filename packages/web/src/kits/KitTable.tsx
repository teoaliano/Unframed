import { applyKitOps, cssName, TOKEN_TYPES, type Kit, type KitOp, type Token, type TokenType, type TokenValue } from "@unframed/domain";
import { useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../chrome/ui.tsx";
import { keepEscapeInField, ValueCell } from "./KitCells.tsx";

const STARTING_VALUE: Record<TokenType, TokenValue> = {
  color: "#000000",
  dimension: "0px",
  fontFamily: "sans-serif",
  fontWeight: 400,
  textStyle: { fontFamily: "sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "0px" },
  shadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
  duration: "200ms",
  easing: "power2.out",
};

const valueIn = (token: Token, mode: string, kit: Kit): TokenValue | undefined => token.value ?? token.values?.[mode] ?? token.values?.[kit.modes[0]!];

const groupOf = (path: string): string => path.split("/")[0]!;

const VIRTUAL_ROWS = 200;
const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 480;
const OVERSCAN = 8;

function windowRows<T>(rows: ReadonlyArray<T>, scrollTop: number, windowing: boolean): { rows: ReadonlyArray<T>; before: number; after: number } {
  if (!windowing) return { rows, before: 0, after: 0 };
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, first + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 2 * OVERSCAN);
  return { rows: rows.slice(first, last), before: first * ROW_HEIGHT, after: (rows.length - last) * ROW_HEIGHT };
}

const tokenOp = (token: Token, body: { readonly value: TokenValue } | { readonly values: Record<string, TokenValue> }, description: string | undefined): KitOp => ({
  op: "setToken",
  path: token.path,
  type: token.type,
  ...body,
  ...(description !== undefined ? { description } : {}),
});

const usedByLabel = (ids: ReadonlyArray<string>, titleOf: (id: string) => string): string => {
  const titles = ids.slice(0, 10).map(titleOf);
  const rest = ids.length - titles.length;
  return rest > 0 ? [...titles, `and ${rest} more`].join("\n") : titles.join("\n");
};

export interface KitUsageCounts {
  readonly tokens: Readonly<Record<string, readonly string[]>>;
  readonly modes: Readonly<Record<string, readonly string[]>>;
}

interface KitTableProps {
  readonly kit: Kit;
  readonly usage: KitUsageCounts;
  readonly apply: (ops: ReadonlyArray<KitOp>) => string | undefined;
  readonly titleOf: (id: string) => string;
  readonly onAskDeleteToken: (path: string) => void;
  readonly onAskDeleteMode: (mode: string) => void;
}

export const KitTable = (props: KitTableProps) => {
  const { kit, usage, apply, titleOf, onAskDeleteToken, onAskDeleteMode } = props;
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingMode, setAddingMode] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [renamingMode, setRenamingMode] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [describing, setDescribing] = useState<string>();
  const [scrollTop, setScrollTop] = useState(0);

  const groups = [...new Set(kit.tokens.map((token) => groupOf(token.path)))].map((name) => ({
    name,
    count: kit.tokens.filter((token) => groupOf(token.path) === name).length,
  }));
  const needle = query.trim();
  const shown = kit.tokens.filter(
    (token) => (group === "All" || groupOf(token.path) === group) && (needle === "" || token.path.includes(needle) || cssName(token.path).includes(needle)),
  );
  const windowed = windowRows(shown, scrollTop, shown.length > VIRTUAL_ROWS);

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
    if (token.value !== undefined) return commit([tokenOp(token, { value }, token.description)]);
    return commit([tokenOp(token, { values: { ...token.values, [mode]: value } }, token.description)]);
  };

  const onePerMode = (token: Token, perMode: boolean) => {
    const base = valueIn(token, kit.modes[0]!, kit);
    if (base === undefined) return;
    if (perMode) commit([tokenOp(token, { values: Object.fromEntries(kit.modes.map((mode) => [mode, base])) }, token.description)]);
    else commit([tokenOp(token, { value: base }, token.description)]);
  };

  const setDescription = (token: Token, text: string): string | undefined => {
    const trimmed = text.trim();
    const description = trimmed === "" ? undefined : trimmed;
    return commit([token.value !== undefined ? tokenOp(token, { value: token.value }, description) : tokenOp(token, { values: token.values ?? {} }, description)]);
  };

  const addToken = (path: string, type: TokenType) => {
    const refusal = commit([{ op: "addToken", path, type, value: STARTING_VALUE[type] }]);
    setProblem(refusal);
    if (refusal === undefined) setAdding(false);
  };

  const startEdit = (start: () => void) => {
    setProblem(undefined);
    start();
  };
  const cancelAdd = () => {
    setProblem(undefined);
    setAdding(false);
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
        <div className="[&_[data-slot=table-container]]:max-h-[480px] [&_[data-slot=table-container]]:overflow-auto [&_[data-slot=table-header]]:bg-popover" onScrollCapture={(event) => setScrollTop((event.target as HTMLElement).scrollTop)}>
          <Table className="min-w-[560px]">
            <TableHeader className="sticky top-0 z-[1]">
              <TableRow>
                <TableHead scope="col">Token</TableHead>
                <TableHead scope="col">Type</TableHead>
                {kit.modes.map((mode, index) => (
                  <TableHead scope="col" key={mode}>
                    {renamingMode === mode ? (
                      <NameField label={`Mode name ${mode}`} initial={mode} onCancel={() => setRenamingMode(undefined)} onCommit={(name) => finish(commit([{ op: "renameMode", name: mode, to: name }]), () => setRenamingMode(undefined))} />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {mode}
                        {index === 0 && mode !== "default" && <span className="text-muted-foreground">default</span>}
                        <OptionsMenu
                          label={`Mode options ${mode}`}
                          align="start"
                          items={[
                            ["Rename mode", () => startEdit(() => setRenamingMode(mode))],
                            index > 0 && ["Make default", () => commit([{ op: "setDefaultMode", name: mode }])],
                            ["Duplicate mode", () => commit([{ op: "addMode", name: `${mode}-copy`, copyFrom: mode }])],
                            kit.modes.length > 1 && ["Delete mode", () => onAskDeleteMode(mode)],
                          ]}
                        />
                      </span>
                    )}
                  </TableHead>
                ))}
                <TableHead scope="col">
                  {addingMode ? (
                    <NameField label="Mode name" initial="" onCancel={() => setAddingMode(false)} onCommit={(name) => finish(commit([{ op: "addMode", name }]), () => setAddingMode(false))} />
                  ) : (
                    <Button variant="ghost" size="xs" onClick={() => startEdit(() => setAddingMode(true))}>
                      Add mode
                    </Button>
                  )}
                </TableHead>
                <TableHead scope="col">Used by</TableHead>
                <TableHead scope="col" className="w-9">
                  <span className="sr-only">Token options</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {windowed.before > 0 && (
                <TableRow aria-hidden style={{ height: windowed.before }}>
                  <TableCell colSpan={kit.modes.length + 5} style={{ padding: 0 }} />
                </TableRow>
              )}
              {windowed.rows.map((token) => {
                const oneValue = token.value !== undefined;
                const former = token.formerNames ?? [];
                const users = usage.tokens[token.path] ?? [];
                return (
                  <TableRow key={token.path} data-token={token.path}>
                    <TableCell className="min-w-[15rem]">
                      <div className="flex items-start gap-1">
                        <span className="grid min-w-0">
                          {renaming === token.path ? (
                            <NameField label={`Rename ${token.path}`} initial={token.path} onCancel={() => setRenaming(undefined)} onCommit={(to) => finish(commit([{ op: "renameToken", path: token.path, to }]), () => setRenaming(undefined))} />
                          ) : (
                            <Tip label={token.path}>
                              <span className="truncate">{token.path}</span>
                            </Tip>
                          )}
                          <Tip label={cssName(token.path)}>
                            <span className="truncate font-mono text-xs text-muted-foreground">{cssName(token.path)}</span>
                          </Tip>
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
                      </div>
                      {describing === token.path && (
                        <NameField
                          label={`Description ${token.path}`}
                          initial={token.description ?? ""}
                          onCancel={() => setDescribing(undefined)}
                          onCommit={(text) => finish(setDescription(token, text), () => setDescribing(undefined))}
                        />
                      )}
                    </TableCell>
                    <TableCell>{token.type}</TableCell>
                    {oneValue ? (
                      <TableCell colSpan={kit.modes.length} data-mode="all">
                        <ValueCell token={token} tokens={kit.tokens} label={token.path} value={token.value} onCommit={(next) => setValue(token, kit.modes[0]!, next)} />
                      </TableCell>
                    ) : (
                      kit.modes.map((mode) => (
                        <TableCell key={mode} data-mode={mode}>
                          <ValueCell token={token} tokens={kit.tokens} label={`${token.path} ${mode}`} value={valueIn(token, mode, kit)} onCommit={(next) => setValue(token, mode, next)} />
                        </TableCell>
                      ))
                    )}
                    <TableCell />
                    <TableCell>
                      {users.length > 0 && (
                        <Tip label={<span className="whitespace-pre-line">{usedByLabel(users, titleOf)}</span>}>
                          <span>{users.length}</span>
                        </Tip>
                      )}
                    </TableCell>
                    <TableCell className="w-9">
                      <OptionsMenu
                        label={`Token options ${token.path}`}
                        align="end"
                        items={[
                          oneValue ? ["A value per mode", () => onePerMode(token, true)] : ["One value for all modes", () => onePerMode(token, false)],
                          ["Rename", () => startEdit(() => setRenaming(token.path))],
                          ["Description", () => startEdit(() => setDescribing(token.path))],
                          former.length > 0 && ["Forget old names", () => former.forEach((name) => commit([{ op: "forgetFormerName", path: token.path, cssName: name }]))],
                          ["Delete", () => onAskDeleteToken(token.path)],
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {windowed.after > 0 && (
                <TableRow aria-hidden style={{ height: windowed.after }}>
                  <TableCell colSpan={kit.modes.length + 5} style={{ padding: 0 }} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {adding ? <AddToken initialPath={group === "All" ? "" : `${group}/`} onAdd={addToken} onCancel={cancelAdd} /> : <Button variant="outline" className="justify-self-start" onClick={() => startEdit(() => setAdding(true))}>Add token</Button>}
        {problem !== undefined && <Alert variant="error">{problem}</Alert>}
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

/** A row's or a column's options menu: its trigger, and the items it offers (a false item is left out). */
const OptionsMenu = ({ label, align, items }: { readonly label: string; readonly align: "start" | "end"; readonly items: ReadonlyArray<false | readonly [string, () => void]> }) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Button ref={trigger} variant="ghost" size="icon-xs" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        …
      </Button>
      <MenuPopup anchor={trigger} side="bottom" align={align}>
        {items.map((item) => item && <MenuItem key={item[0]} onClick={item[1]}>{item[0]}</MenuItem>)}
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
