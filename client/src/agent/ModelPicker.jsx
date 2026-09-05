import { useEffect, useMemo, useState } from 'react';
import { Popover } from '@astryxdesign/core/Popover';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { ChevronDown, Star } from 'lucide-react';

// The composer's two footer pickers, after T3 Code's (github.com/pingdotgg/t3code,
// apps/web/src/components/chat/ProviderModelPicker.tsx and its Reasoning select): small
// ghost triggers, and a popup each. The model popup has a rail of providers down the
// left (favourites first), a search field, and two-line rows -- model name, then the
// provider under it -- with a ⌘N jump key and a favourite star on the right. The effort
// popup is a short list headed "Reasoning". Astryx has no component with this shape, so
// the popup is Astryx's Popover, Kbd and Badge around our own rows, styled from tokens
// only (styles.css, `.mp-*`). Departures from T3, asked for: the providers are tabs
// across the top rather than a rail, there is no search, rows are one line, and the
// SDK's "default" alias is folded into the model it stands for.
//
// Rows come from the provider probe (server/providers.js: the account's models, with a
// description and the effort levels each accepts). Codex is on the rail because it is
// detected, and says that sessions on it do not exist yet rather than listing models a
// thread cannot run (docs/agent.md).

export const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const EFFORT_HINT = {
  low: 'Fastest; little reasoning',
  medium: 'Balanced',
  high: 'More reasoning before acting',
  xhigh: 'Long reasoning; slower',
  max: 'Everything the model has',
};

const FAVORITES_KEY = 'unframed:agent-favorites';
const readFavorites = () => {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// Provider logos, inline so nothing is fetched. The paths are the ones t3code ships
// (apps/web/src/components/Icons.tsx, MIT): the Claude wordmark's starburst and the
// OpenAI knot for Codex. Both paint in currentColor; the Claude one takes the accent
// through `.mp-mark--claude`, since a raw brand hex belongs in theme.js and nowhere else.
const CLAUDE_PATH =
  'm50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z';
const OPENAI_PATH =
  'M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z';

export function ProviderMark({ kind, size = 14 }) {
  const codex = kind === 'codex';
  return (
    <svg className={`mp-mark${codex ? '' : ' mp-mark--claude'}`} width={size} height={size} viewBox={codex ? '0 0 256 260' : '0 0 256 257'} preserveAspectRatio="xMidYMid" fill="currentColor" aria-hidden="true">
      <path d={codex ? OPENAI_PATH : CLAUDE_PATH} />
    </svg>
  );
}

function Trigger({ children, disabled, label }) {
  return (
    <button type="button" className="mp-trigger" disabled={disabled} aria-label={label}>
      {children}
      <Icon icon={ChevronDown} size="sm" />
    </button>
  );
}

// `models` is the Claude probe's list; `value` '' is the provider's default.
export function ModelPicker({ provider, codex, models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState('claude');
  const [favorites, setFavorites] = useState(readFavorites);

  // Every model the SDK lists, by name. The SDK's own "default" row is an alias for one
  // of the others (same description), so it is folded into that row rather than shown:
  // a thread with no model set reads as the model it will actually run.
  const rows = useMemo(() => models.filter((m) => m.id !== 'default'), [models]);
  const defaultRow = useMemo(() => {
    const def = models.find((m) => m.id === 'default');
    return (def && rows.find((r) => r.description && r.description === def.description)) ?? rows[0] ?? null;
  }, [models, rows]);

  const shown = useMemo(() => (rail === 'favorites' ? rows.filter((r) => favorites.includes(r.id)) : rail === 'claude' ? rows : []), [rows, rail, favorites]);

  useEffect(() => {
    if (!open) return undefined;
    setRail(favorites.length && favorites.includes(value) ? 'favorites' : 'claude');
    // ⌘1…⌘9 pick the Nth visible row, as T3 Code's picker does.
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !/^[1-9]$/.test(e.key)) return;
      const r = shown[Number(e.key) - 1];
      if (!r) return;
      e.preventDefault();
      onChange(r.id);
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleFavorite = (id) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: favourites live for the session only
    }
  };

  const selected = (value ? rows.find((r) => r.id === value) : null) ?? defaultRow;

  const content = (
    <div className="mp" role="none">
      <div className="mp-tabs" role="tablist" aria-label="Providers">
        <button type="button" role="tab" aria-selected={rail === 'favorites'} className={`mp-tab${rail === 'favorites' ? ' mp-tab--on' : ''}`} onClick={() => setRail('favorites')} title="Favourites">
          <Icon icon={Star} size="sm" />
        </button>
        <button type="button" role="tab" aria-selected={rail === 'claude'} className={`mp-tab${rail === 'claude' ? ' mp-tab--on' : ''}`} onClick={() => setRail('claude')}>
          <ProviderMark kind="claude" size={14} />
          {provider.name}
        </button>
        {codex?.installed && (
          <button type="button" role="tab" aria-selected={rail === 'codex'} className={`mp-tab${rail === 'codex' ? ' mp-tab--on' : ''}`} onClick={() => setRail('codex')}>
            <ProviderMark kind="codex" size={14} />
            {codex.name}
          </button>
        )}
      </div>
      <div className="mp-main">
        <div className="mp-list" role="listbox" aria-label="Models">
          {rail === 'codex' ? (
            <div className="mp-empty">
              <Text weight="medium">{codex.name}</Text>
              <Text type="supporting" color="secondary">
                {codex.status === 'ready' ? 'Detected and signed in. Threads on Codex are not supported yet; they run on Claude.' : codex.message || 'Installed but not signed in.'}
              </Text>
            </div>
          ) : shown.length === 0 ? (
            <div className="mp-empty">
              <Text type="supporting" color="secondary">
                {rail === 'favorites' ? 'Star a model to keep it here.' : 'No models reported.'}
              </Text>
            </div>
          ) : (
            shown.map((r, i) => (
              <div
                key={r.id}
                role="option"
                aria-selected={r.id === selected?.id}
                tabIndex={0}
                className={`mp-row${r.id === selected?.id ? ' mp-row--on' : ''}`}
                onClick={() => {
                  onChange(r.id);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(r.id);
                    setOpen(false);
                  }
                }}
              >
                <div className="mp-row-text" title={r.description || undefined}>
                  <span className="mp-row-name">{r.name}</span>
                </div>
                {i < 9 && <Kbd keys={`mod+${i + 1}`} />}
                <button
                  type="button"
                  className={`mp-star${favorites.includes(r.id) ? ' mp-star--on' : ''}`}
                  aria-label={favorites.includes(r.id) ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(r.id);
                  }}
                >
                  <Icon icon={Star} size="sm" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <Popover content={content} isOpen={open} onOpenChange={setOpen} isEnabled={!disabled} placement="above" alignment="start" label="Choose a model" width={420}>
      <Trigger disabled={disabled} label={`Model: ${selected?.name ?? provider.name}`}>
        <ProviderMark kind="claude" />
        <span className="mp-trigger-label">{selected?.name ?? provider.name}</span>
      </Trigger>
    </Popover>
  );
}

// `efforts` are the levels the chosen model accepts; `value` '' is Auto (nothing passed).
export function EffortPicker({ efforts, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rows = [{ id: '', label: 'Auto', hint: 'The model decides how much to think', isDefault: true }, ...efforts.map((e) => ({ id: e, label: EFFORT_LABEL[e] ?? e, hint: EFFORT_HINT[e] ?? '' }))];
  const content = (
    <div className="mp mp--effort" role="none">
      <div className="mp-main">
        <Text type="supporting" color="secondary" className="mp-heading">
          Reasoning
        </Text>
        <div className="mp-list" role="listbox" aria-label="Reasoning effort">
          {rows.map((r) => (
            <div
              key={r.id || '__auto'}
              role="option"
              aria-selected={r.id === value}
              tabIndex={0}
              className={`mp-row mp-row--flat${r.id === value ? ' mp-row--on' : ''}`}
              onClick={() => {
                onChange(r.id);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(r.id);
                  setOpen(false);
                }
              }}
            >
              <div className="mp-row-text">
                <span className="mp-row-name">
                  {r.label}
                  {r.isDefault && <Badge label="Default" />}
                </span>
                {r.hint && <span className="mp-row-sub">{r.hint}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  const label = value ? EFFORT_LABEL[value] ?? value : 'Auto';
  return (
    <Popover content={content} isOpen={open} onOpenChange={setOpen} isEnabled={!disabled} placement="above" alignment="start" label="Reasoning effort" width={280}>
      <Trigger disabled={disabled} label={`Reasoning: ${label}`}>
        <span className="mp-trigger-label">{label}</span>
      </Trigger>
    </Popover>
  );
}
