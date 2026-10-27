/**
 * The Kit table (spec 19): the groups on the left, the search, the tokens as rows with one column
 * per mode, the row menu that picks one value or one per mode, and Add token.
 */
import { applyKitOps, cssName, TOKEN_TYPES, type Kit, type KitOp, type Token, type TokenType, type TokenValue } from "@unframed/domain";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { ValueCell } from "./KitCells.tsx";

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

export const KitTable = ({ kit, usage, apply }: { readonly kit: Kit; readonly usage: Readonly<Record<string, readonly string[]>>; readonly apply: (ops: ReadonlyArray<KitOp>) => string | undefined }) => {
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string>();

  const groups = [...new Set(kit.tokens.map((token) => groupOf(token.path)))].map((name) => ({
    name,
    count: kit.tokens.filter((token) => groupOf(token.path) === name).length,
  }));
  const needle = query.trim();
  const shown = kit.tokens.filter(
    (token) => (group === "All" || groupOf(token.path) === group) && (needle === "" || token.path.includes(needle) || cssName(token.path).includes(needle)),
  );

  const commit = (ops: ReadonlyArray<KitOp>) => {
    const refusal = applyKitOps(kit, ops);
    if (!refusal.ok) return refusal.refusal;
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
                    {mode}
                    {index === 0 && <span className="ml-1 text-muted-foreground/70">default</span>}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 font-medium">Used by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((token) => {
                const oneValue = token.value !== undefined;
                return (
                  <tr key={token.path} data-token={token.path} className="border-t align-top">
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-1">
                        <span className="grid min-w-0">
                          <span className="truncate">{token.path}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{cssName(token.path)}</span>
                        </span>
                        <RowMenu token={token} onePerMode={(perMode) => onePerMode(token, perMode)} oneValue={oneValue} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{token.type}</td>
                    {oneValue ? (
                      <td className="px-2 py-2" colSpan={kit.modes.length} data-mode="all">
                        <ValueCell token={token} label={`${token.path}`} value={token.value} onCommit={(next) => setValue(token, kit.modes[0]!, next)} />
                      </td>
                    ) : (
                      kit.modes.map((mode) => (
                        <td key={mode} className="px-2 py-2" data-mode={mode}>
                          <ValueCell token={token} label={`${token.path} ${mode}`} value={valueIn(token, mode, kit)} onCommit={(next) => setValue(token, mode, next)} />
                        </td>
                      ))
                    )}
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{usage[token.path]?.length || ""}</td>
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

const RowMenu = ({ token, oneValue, onePerMode }: { readonly token: Token; readonly oneValue: boolean; readonly onePerMode: (perMode: boolean) => void }) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Button ref={trigger} variant="ghost" size="icon-xs" aria-label={`Token options ${token.path}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        …
      </Button>
      <MenuPopup anchor={trigger} side="bottom" align="end">
        {oneValue ? (
          <MenuItem onClick={() => onePerMode(true)}>A value per mode</MenuItem>
        ) : (
          <MenuItem onClick={() => onePerMode(false)}>One value for all modes</MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
};

const AddToken = ({ initialPath, onAdd, onCancel }: { readonly initialPath: string; readonly onAdd: (path: string, type: TokenType) => void; readonly onCancel: () => void }) => {
  const [path, setPath] = useState(initialPath);
  const [type, setType] = useState<TokenType>("color");
  const items = TOKEN_TYPES.map((value) => ({ value, label: value }));
  return (
    <div className="flex flex-wrap items-center gap-2" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
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
