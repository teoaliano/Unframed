// The markup the output nodes share. Split from core.js on logic-vs-JSX, which is the
// only boundary that pays for itself at this size — six small files would cost more to
// navigate than the duplication they removed.

import { useState } from 'react';
import { Text } from '@astryxdesign/core/Text';
import NodeLine from '../NodeLine.jsx';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { ratioLabel } from './core.js';
import ModelDialog from './ModelDialog.jsx';

// A raw <select>, which breaks client/.claude/CLAUDE.md's "no <div>, components do all
// layout/spacing" rule on purpose. Astryx popups are positioned purely by CSS anchor
// positioning, and where the anchor fails to resolve they render at the viewport corner
// instead of on their node -- reproducible in the packaged Electron app and in Safari,
// not fixable from this repo, and NOT fixed by the 0.4.3 upgrade. A native select's
// list is drawn by the OS, outside the page's layout entirely, so it cannot be
// mispositioned by any of that. The closed box is still Astryx: every value below is a
// token, copied from the same inputStyles the Selector's own box uses, so it follows a
// theme change. The trade is deliberate -- take the popup back to a component the day
// anchor positioning is reliable everywhere Unframed runs.
// Its props mirror Selector's (label/options/value/onChange) so the call sites read the
// same. There is no `hasSearch`: a native select has the OS's own type-ahead, which is
// what that prop was standing in for.
export function NativeSelect({ label, options, value, onChange }) {
  return (
    <label className="xnode-native-select">
      {/* secondary + type="label" is exactly what Astryx's own FieldLabel renders,
          so these sit at the same weight and colour as the Model and Runs labels. */}
      <Text type="label" color="secondary">{label}</Text>
      <select
        // nodrag, or a click that opens the list pans the canvas instead.
        className="nodrag"
        // The wrapping <label> already focuses the control on click, but naming it
        // through that label would read the whole option list out as the name -- the
        // accessible name of a wrapped control includes its own subtree. Naming it
        // here gives exactly what the Astryx Selector announced: "Quality, combobox".
        aria-label={label}
        // '' is the placeholder row's value, so an unsupported stored value (the
        // `includes` checks below resolve to undefined) shows the dash rather than
        // silently displaying the model's first option as if it were chosen.
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {value == null && <option value="">—</option>}
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label ?? opt.value}
            </option>
          );
        })}
      </select>
    </label>
  );
}

// Labelled by slug, not OpenRouter's display name: the slug is what you put in
// OPENROUTER_IMAGE_MODEL, and it keeps every row in one format. The picker is a
// button into a centered dialog rather than an anchored popup — the dialog is
// immune to the anchor-positioning failures that hit Astryx popups in the
// packaged app and Safari, and it has room for search, filters and price that
// 200px never had. Mounted only while open: each node owns its own picker, and
// an unmounted dialog costs nothing.
export function ModelPicker({ models, value, onChange, kind }) {
  const [open, setOpen] = useState(false);
  return (
    <VStack gap={1}>
      <Text type="label" color="secondary">Model</Text>
      <Button
        // nodrag on the control, not on the VStack around it: the class takes
        // everything beneath it out of the drag surface, so on the wrapper it would
        // cost the "Model" caption its grab area too. Every other label in a node
        // drags. (The list itself is a modal dialog now, rendered outside the node,
        // so unlike the old in-node popup it needs nothing here.)
        className="nodrag"
        label={value || 'Loading models…'}
        // A <button> is not a labelable element, so the visible "Model" caption
        // above it (and the wrapping VStack, rather than a <label> for exactly
        // this reason) names nothing for it — the button must name itself.
        aria-label={`Model: ${value || 'Loading models…'}`}
        size="sm"
        variant="secondary"
        width="100%"
        isDisabled={!models.length}
        onClick={() => setOpen(true)}
      />
      {open && (
        <ModelDialog
          models={models}
          kind={kind}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </VStack>
  );
}

// One control per parameter the selected model declares, and none for the rest.
// `params` is the object from useModelParams; `data` is the node's data; `onChange`
// takes the same partial update object updateNodeData does.
// `children` are the calling node's own controls, rendered INSIDE this row rather than
// under it: a second HStack could never wrap into this one, so a wide control below
// (video's "First and last frame") pushed its neighbours out of the card while there was
// still space beside Size. One row, wrapping, is the only arrangement where every control
// shares the same space budget.
export function ParamControls({ params, data, onChange, children }) {
  const { exactSizes, resolutionTiers, qualities, backgrounds, ratios } = params;
  return (
    <HStack gap={2} align="end" wrap="wrap">
      {exactSizes && (
        <NativeSelect
          label="Size"
          options={exactSizes.map((s) => {
            const r = ratioLabel(s);
            return { value: s, label: r ? `${s} · ${r}` : s };
          })}
          value={exactSizes.includes(data.size) ? data.size : undefined}
          onChange={(v) => onChange({ size: v })}
        />
      )}
      {resolutionTiers && (
        <NativeSelect
          label="Size"
          options={resolutionTiers}
          value={resolutionTiers.includes(data.resolution) ? data.resolution : undefined}
          onChange={(v) => onChange({ resolution: v })}
        />
      )}
      {qualities && (
        <NativeSelect
          label="Quality"
          options={qualities}
          value={qualities.includes(data.quality) ? data.quality : undefined}
          onChange={(v) => onChange({ quality: v })}
        />
      )}
      {backgrounds && (
        <NativeSelect
          label="Background"
          options={backgrounds}
          value={backgrounds.includes(data.background) ? data.background : undefined}
          onChange={(v) => onChange({ background: v })}
        />
      )}
      {ratios && (
        <NativeSelect
          label="Ratio"
          options={ratios}
          value={ratios.includes(data.aspect_ratio) ? data.aspect_ratio : undefined}
          onChange={(v) => onChange({ aspect_ratio: v })}
        />
      )}
      {children}
    </HStack>
  );
}

// What the run cost reports on is the node as a WHOLE, not the last result above it —
// the same kind of fact as an input node's connection role, so it lives in the same
// place: NodeLine, at the right end of the node's name row. See
// docs/superpowers/specs/2026-08-20-node-anatomy-redesign-design.md.
//
// Only LABELS come here. The Clear button each output used to pass through this
// component's `after` slot could not follow the cost out: a control sitting on the
// canvas rather than inside a node has no `nodrag` ancestor to opt out of the drag
// surface, so it would fight every press. It moved into the body, beside the result
// strip it empties. `extra` is what remains — a video's pre-run estimate, an image
// batch's result count — and it stays caller-specific because it differs per medium.
export function CostFoot({ cost, extra }) {
  if (cost == null && !extra) return null;
  return (
    <NodeLine>
      {[cost != null ? `$${Number(cost).toFixed(4)}` : null, extra].filter(Boolean).join(' · ')}
    </NodeLine>
  );
}
