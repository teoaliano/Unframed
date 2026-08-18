import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack, HStack } from '@astryxdesign/core/Stack';
import StatusLine from './StatusLine.jsx';

/**
 * What Free mode is about to send, before a single image is paid for.
 *
 * The textarea holds the LIST TEXT -- sections, their --- separators and their `images:`
 * directives -- and every row below it is derived from that text by the same freeBatch()
 * call Generate uses. One source of truth on purpose: a preview that assembled its own
 * rows would eventually disagree with what gets sent, which is the one thing a preview
 * must never do.
 *
 * Edits are deliberately transient. They are not written back to the source node, whose
 * text or result must keep saying what the model actually produced.
 */
export default function FreePreviewDialog({ staged, derive, onCancel, onConfirm }) {
  const [text, setText] = useState(staged.listText);
  const { runs, truncated, shared, error } = derive(text);

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onCancel()} purpose="form" width={640}>
      <DialogHeader
        title="Final prompt"
        subtitle={
          error
            ? 'This list cannot be assembled yet.'
            : `${runs.length} generation${runs.length === 1 ? '' : 's'}. Nothing has been sent yet.`
        }
      />
      <VStack gap={3} padding={4}>
        {shared && (
          <VStack gap={1}>
            <Text type="label" color="secondary">Shared by every run</Text>
            {/* Read-only: it comes from the other wired nodes, not from this list. Each
                run is this text, a blank line, then its own section. */}
            <Text type="supporting" color="secondary">{shared}</Text>
          </VStack>
        )}

        <VStack gap={1}>
          <Text type="label" as="label" color="secondary">Sections</Text>
          <TextArea
            label="List text"
            isLabelHidden
            rows={12}
            hasSpellCheck={false}
            value={text}
            onChange={(v) => setText(v)}
          />
        </VStack>

        {error ? (
          <StatusLine type="error">{error}</StatusLine>
        ) : (
          <VStack gap={1}>
            {/* How the directives were READ, not what was typed -- the whole point of
                looking. "all images" is what a section with no directive gets. */}
            {runs.map((run, i) => (
              <HStack key={i} gap={2}>
                <Text type="label" color="secondary">Run {i + 1}</Text>
                <Text type="label">{run.used ? `images ${run.used.join(', ')}` : 'all images'}</Text>
              </HStack>
            ))}
            {truncated > 0 && (
              <StatusLine type="warning">
                {truncated} more section{truncated === 1 ? '' : 's'} beyond the 10-run cap will not run.
              </StatusLine>
            )}
          </VStack>
        )}

        {staged.notes.length > 0 && <StatusLine type="info">{staged.notes.join(' · ')}</StatusLine>}

        <HStack gap={2} justify="end">
          <Button label="Cancel" variant="ghost" onClick={onCancel} />
          <Button
            label={`Generate ${runs.length}×`}
            variant="primary"
            isDisabled={Boolean(error) || runs.length === 0}
            onClick={() => onConfirm(text)}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
