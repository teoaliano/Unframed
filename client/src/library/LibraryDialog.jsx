import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { ImageIcon, TextIcon, VideoIcon } from '../nodes/nodeIcons.jsx';
import { PRESETS, CATEGORIES } from './index.js';

// What a preset produces, worn as a small badge on its card.
const KIND_ICONS = { image: ImageIcon, video: VideoIcon, text: TextIcon };

// Browse-and-add over the preset catalogue: search, category chips, card grid.
// Search and filters are plain derived state over the bundled array — with the
// catalogue shipped inside the app there is nothing to fetch or debounce.
// No sort control yet: presets carry no date or popularity to sort by, and a
// picker with one meaningful order would just be furniture. The toolbar has room
// for it the day the data exists.
export default function LibraryDialog({ isOpen, onOpenChange, onAdd }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const q = query.trim().toLowerCase();
  const shown = PRESETS.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      (!q || `${p.name} ${p.summary}`.toLowerCase().includes(q)),
  );

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={680}>
      <DialogHeader title="Library" />
      <VStack gap={3} padding={4}>
        <HStack gap={2} align="center">
          <span className="lib-search">
            <TextInput
              label="Search presets"
              isLabelHidden
              size="sm"
              startIcon="search"
              placeholder="Search presets…"
              value={query}
              onChange={setQuery}
            />
          </span>
          <SegmentedControl label="Category" size="sm" value={category} onChange={setCategory}>
            <SegmentedControlItem value="all" label="All" />
            {CATEGORIES.map((c) => (
              <SegmentedControlItem key={c} value={c} label={c[0].toUpperCase() + c.slice(1)} />
            ))}
          </SegmentedControl>
        </HStack>

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing here yet. Try another category or clear the search.
          </Text>
        ) : (
          <div className="lib-grid">
            {shown.map((p) => {
              const KindIcon = KIND_ICONS[p.kind];
              return (
                <Card className="lib-card" padding={0} key={p.id}>
                  {/* Every card's cover is drawn, not shipped: the canvas's own
                      dot grid with a soft accent glow behind the kind icon, so
                      the repo never carries screenshot payloads. */}
                  <div className="lib-card-preview lib-card-placeholder" aria-hidden>
                    {KindIcon && <KindIcon />}
                  </div>
                  <VStack gap={1} padding={3}>
                    <HStack gap={2} align="center">
                      <Text type="body" weight="medium">{p.name}</Text>
                      {KindIcon && (
                        <span className="lib-card-kind" title={`Makes ${p.kind}s`}>
                          <Icon icon={KindIcon} size="sm" color="secondary" />
                        </span>
                      )}
                    </HStack>
                    <Text type="supporting">{p.summary}</Text>
                    <Text type="supporting" color="secondary">Needs: {p.needs}</Text>
                    <HStack gap={2} align="center">
                      <Text type="supporting" color="secondary">{p.category}</Text>
                      <span className="lib-card-add">
                        <Button label="Add" size="sm" variant="secondary" onClick={() => onAdd(p)} />
                      </span>
                    </HStack>
                  </VStack>
                </Card>
              );
            })}
          </div>
        )}
      </VStack>
    </Dialog>
  );
}
