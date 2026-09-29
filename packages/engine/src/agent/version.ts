import manifest from "../../package.json" with { type: "json" };

/** The engine's version, as its package declares it. */
export const ENGINE_VERSION: string = manifest.version;
