import * as Schema from "effect/Schema";

/** What the web may know about the settings. The key itself is never part of it. */
export const Settings = Schema.Struct({
  hasKey: Schema.Boolean,
  keyHint: Schema.String,
  imageModel: Schema.String,
  textModel: Schema.String,
  videoModel: Schema.String,
  outputDir: Schema.String,
  claudePath: Schema.String,
  codexPath: Schema.String,
  claudeConfigDir: Schema.String,
  previewPort: Schema.Number,
});
export type Settings = typeof Settings.Type;

export const Health = Schema.Struct({
  ...Settings.fields,
  ok: Schema.Literal(true),
});
export type Health = typeof Health.Type;

export const SettingsPatch = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  imageModel: Schema.optionalKey(Schema.String),
  textModel: Schema.optionalKey(Schema.String),
  videoModel: Schema.optionalKey(Schema.String),
  outputDir: Schema.optionalKey(Schema.String),
  claudePath: Schema.optionalKey(Schema.String),
  codexPath: Schema.optionalKey(Schema.String),
  claudeConfigDir: Schema.optionalKey(Schema.String),
});
export type SettingsPatch = typeof SettingsPatch.Type;
