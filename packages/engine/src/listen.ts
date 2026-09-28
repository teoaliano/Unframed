import type http from "node:http";

export const LOOPBACK_HOST = "127.0.0.1";

/** Binds `127.0.0.1` only. There is no option to widen the bind. */
export const listenLoopback = (server: http.Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("The listener has no port."));
      else resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host: LOOPBACK_HOST, exclusive: true });
  });
