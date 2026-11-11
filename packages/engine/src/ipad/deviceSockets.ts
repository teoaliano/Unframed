import type http from "node:http";

export const CLIENT_HEADER = "x-unframed-client";

const DEVICE = Symbol.for("unframed/ipad/device");

type Tagged = http.IncomingMessage & { [DEVICE]?: string };

export const markDeviceRequest = (req: http.IncomingMessage, deviceId: string): void => {
  (req as Tagged)[DEVICE] = deviceId;
};

export const deviceOfRequest = (req: http.IncomingMessage): string | undefined => (req as Tagged)[DEVICE];
