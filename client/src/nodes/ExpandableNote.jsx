import { useId, useState } from 'react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';

// A control with an explanation folded away behind a chevron at the end of its
// row. Collapsed by default: the note answers "what will this do", which is worth
// having but not worth the space it takes on every render.
//
// Deliberately not Astryx's Collapsible: that renders its own trigger BUTTON, and
// the row here is a checkbox. An input inside a button is invalid markup and the
// button swallows the clicks meant for the control, so the chevron sits beside
// the control rather than wrapping it.
export default function ExpandableNote({ row, children, label = 'Show details' }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="xnode-note">
      <div className="xnode-note-row">
        {row}
        <IconButton
          size="sm"
          variant="ghost"
          label={open ? 'Hide details' : label}
          aria-expanded={open}
          aria-controls={id}
          icon={
            <span className={`xnode-note-chevron${open ? ' is-open' : ''}`}>
              <Icon icon="chevronDown" size="xsm" />
            </span>
          }
          onClick={() => setOpen((v) => !v)}
        />
      </div>
      {/* Unmounted rather than hidden: nothing here needs to keep state, and a
          node's height should not reserve space for text nobody asked for. */}
      {open && (
        <div className="xnode-note-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}
