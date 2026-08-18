// The markup the output nodes share. Split from core.js on logic-vs-JSX, which is the
// only boundary that pays for itself at this size — six small files would cost more to
// navigate than the duplication they removed.

import { Text } from '@astryxdesign/core/Text';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { capabilityTags, ratioLabel } from './core.js';

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
// OPENROUTER_IMAGE_MODEL, and it keeps every row in one format. Capabilities sit on
// the row so a model is chosen by what it can do rather than by its name — without
// them the differences only surfaced after the fact, as a control that quietly did
// nothing. `kind` is the catalogue name, which decides which tags are worth showing.
export function ModelPicker({ models, value, onChange, kind }) {
  return (
    // Wrapped in a stack of its own PURELY to carry `nodrag`: Astryx moves an open
    // popup out of its trigger and up to the nearest stack, so this is the tightest
    // container that can catch it. Tight on purpose -- the class stops anything under
    // it from dragging the node, so it must cover the control and nothing else, or the
    // labels and gaps around it stop being grab surfaces too.
    <VStack className="nodrag">
    <Selector
      label="Model"
      size="sm"
      hasSearch
      options={models.map((m) => ({ value: m.id, label: m.id }))}
      value={value}
      placeholder="Loading models…"
      renderOption={(opt) => {
        const tags = capabilityTags(models.find((m) => m.id === opt.value), kind);
        return (
          <span className="model-option">
            <span className="model-option-id">{opt.label ?? opt.value}</span>
            {tags.length > 0 && (
              <span className="model-option-tags">
                {tags.map((t) => (
                  <span className="model-tag" key={t}>{t}</span>
                ))}
              </span>
            )}
          </span>
        );
      }}
      onChange={onChange}
    />
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

// What the run cost sits in a footer rather than in the body's flow: it reports on the
// node as a whole, so it reads better banded off against the same rule as the title
// than stacked under the last result. `cost` is null when there is nothing to bill
// yet; `before` and `after` are the caller's own extras (an estimate, a Clear button),
// which stay caller-specific because they differ per medium.
export function CostFoot({ cost, before, after }) {
  if (cost == null && !before && !after) return null;
  return (
    <div className="xnode-foot">
      {before}
      {cost != null && (
        <Text type="supporting" color="accent" hasTabularNumbers>
          ${Number(cost).toFixed(4)}
        </Text>
      )}
      {after}
    </div>
  );
}
