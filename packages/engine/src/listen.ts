import type http from "node:http";

export const LOOPBACK_HOST = "127.0.0.1";

const listenOn = (server: http.Server, host: string, port: number): Promise<number> =>
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
    server.listen({ port, host, exclusive: true });
  });

/** Binds `127.0.0.1` only. There is no option to widen the bind. */
export const listenLoopback = (server: http.Server, port: number): Promise<number> => listenOn(server, LOOPBACK_HOST, port);

const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EINVAL"]);

export const listenBothLoopbacks = async (make: () => http.Server, wanted: number): Promise<{ readonly port: number; readonly servers: ReadonlyArray<http.Server> }> => {
  let fixed = wanted !== 0;
  for (let attempt = 0; ; attempt++) {
    const v4 = make();
    const port = await listenLoopback(v4, fixed ? wanted : 0).catch((error: unknown) => {
      if (fixed) return undefined;
      throw error;
    });
    if (port === undefined) {
      fixed = false;
      continue;
    }
    const v6 = make();
    const both = await listenOn(v6, "::1", port).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (NO_IPV6.has(error.code ?? "")) return false;
        if (fixed || attempt < 5) return undefined;
        return false;
      },
    );
    if (both === undefined) {
      v4.close();
      fixed = false;
      continue;
    }
    return { port, servers: both ? [v4, v6] : [v4] };
  }
};
