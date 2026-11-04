import * as Schema from "effect/Schema";

export const IpadStatus = Schema.Struct({
  localName: Schema.NullOr(Schema.String),
  port: Schema.Number,
  listening: Schema.Boolean,
  portTaken: Schema.Boolean,
  testHosts: Schema.NullOr(Schema.Array(Schema.String)),
});
export type IpadStatus = typeof IpadStatus.Type;

export const IpadSetAvailability = Schema.Struct({ available: Schema.Boolean });

export const IpadPairStartAnswer = Schema.Struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
});

export const IpadDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pairedAt: Schema.String,
  lastSeenAt: Schema.NullOr(Schema.String),
});
export type IpadDevice = typeof IpadDevice.Type;

export const IpadDevicesAnswer = Schema.Struct({ devices: Schema.Array(IpadDevice) });

export const IpadRevoke = Schema.Struct({ id: Schema.String });

export const IpadExportProfileAnswer = Schema.Struct({ path: Schema.String });
