import { createRequire } from "node:module";
import type { CliBackendPlugin } from "./cli-backend.types.js";

export type PluginCliBackendEntry = CliBackendPlugin & {
  pluginId: string;
};

type PluginRuntimeModule = Pick<typeof import("./runtime.js"), "getActivePluginRegistry">;

const require = createRequire(import.meta.url);
const RUNTIME_MODULE_CANDIDATES = ["./runtime.js", "./runtime.ts"] as const;

let pluginRuntimeModule: PluginRuntimeModule | undefined;

function loadPluginRuntime(): PluginRuntimeModule | null {
  if (pluginRuntimeModule) {
    return pluginRuntimeModule;
  }
  let lastError: unknown;
  for (const candidate of RUNTIME_MODULE_CANDIDATES) {
    try {
      pluginRuntimeModule = require(candidate) as PluginRuntimeModule;
      return pluginRuntimeModule;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "MODULE_NOT_FOUND") {
        // Candidate not present — try the next one.
        lastError = err;
        continue;
      }
      // Any other error (eval-time crash, syntax error, etc.) is a real
      // failure: surface it rather than silently returning no backends.
      throw err;
    }
  }
  // All candidates were absent (MODULE_NOT_FOUND on every path).
  void lastError;
  return null;
}

export function resolveRuntimeCliBackends(): PluginCliBackendEntry[] {
  return (loadPluginRuntime()?.getActivePluginRegistry()?.cliBackends ?? []).map((entry) => ({
    ...entry.backend,
    pluginId: entry.pluginId,
  }));
}
