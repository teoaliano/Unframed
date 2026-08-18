// The model picker's dialog. Viewport-centered, which is the point: Astryx's
// anchor-positioned popups can render at the viewport corner when the anchor
// fails to resolve (packaged app, Safari), and a centered Dialog is immune by
// construction. For the same reason NOTHING anchor-positioned goes inside it —
// pills are ToggleButtons, and any future select in here is NativeSelect.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { Pagination } from '@astryxdesign/core/Pagination';
import { List } from '@astryxdesign/core/List';
import { Item } from '@astryxdesign/core/Item';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { capabilityTags } from './core.js';
import { buildFacets, applyFacets, priceLabel } from './facets.js';

const PAGE_SIZE = 10;
const TITLES = { image: 'Image models', video: 'Video models', text: 'Text models' };

export default function ModelDialog({ models, kind, value, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);

  const facets = useMemo(() => buildFacets(models, kind), [models, kind]);
  const shown = useMemo(
    () => applyFacets(models, kind, query, selected),
    [models, kind, query, selected],
  );

  // A new search or filter is a new result set; page 3 of the old one means
  // nothing. Same rule as the Library.
  useEffect(() => setPage(1), [query, selected]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggle = (key, v) =>
    setSelected((s) => {
      const cur = s[key] || [];
      return { ...s, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  return (
    // nodrag/nowheel: the dialog's DOM lives inside the node's subtree, so
    // without them a drag inside the dialog moves the node under it and a
    // scroll pans the canvas.
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} width={680} className="nodrag nowheel">
      <DialogHeader title={TITLES[kind] || 'Models'} />
      <VStack gap={3} padding={4}>
        <TextInput
          label="Search models"
          isLabelHidden
          size="sm"
          startIcon="search"
          placeholder="Search models…"
          value={query}
          onChange={setQuery}
        />

        {facets.length > 0 && (
          <HStack gap={1} align="center" wrap="wrap">
            {facets.flatMap((f) =>
              f.values.map((v) => (
                <ToggleButton
                  key={`${f.key}:${v.value}`}
                  label={`${v.label} (${v.count})`}
                  size="sm"
                  isPressed={Boolean(selected[f.key]?.includes(v.value))}
                  onPressedChange={() => toggle(f.key, v.value)}
                />
              )),
            )}
          </HStack>
        )}

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            No model matches. Clear the search or a filter.
          </Text>
        ) : (
          <div className="model-dialog-list">
            <List density="compact">
              {paged.map((m) => {
                const tags = capabilityTags(m, kind);
                const price = priceLabel(m, kind);
                return (
                  <Item
                    as="li"
                    key={m.id}
                    density="compact"
                    isSelected={m.id === value}
                    onClick={() => { onPick(m.id); onClose(); }}
                    label={
                      <HStack gap={1} align="center" wrap="wrap">
                        {/* Slug, not display name: the slug is what goes in
                            OPENROUTER_*_MODEL, same rule as the old picker. */}
                        <Text type="body" weight="medium">{m.id}</Text>
                        {tags.map((t) => (
                          <span className="model-tag" key={t}>{t}</span>
                        ))}
                      </HStack>
                    }
                    description={m.name !== m.id ? m.name : undefined}
                    endContent={
                      price && (
                        <Text type="supporting" color="secondary" hasTabularNumbers>
                          {price}
                        </Text>
                      )
                    }
                  />
                );
              })}
            </List>
          </div>
        )}

        {shown.length > PAGE_SIZE && (
          <HStack justify="end">
            <Pagination
              page={current}
              onChange={setPage}
              totalItems={shown.length}
              pageSize={PAGE_SIZE}
              variant="count"
              size="sm"
            />
          </HStack>
        )}
      </VStack>
    </Dialog>
  );
}
