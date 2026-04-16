import {
  sanitizeSessionHistory,
  validateReplayTurns,
} from "./replay-history.js";
import {
  logProviderToolSchemaDiagnostics,
  normalizeProviderToolSchemas,
} from "./tool-schema-runtime.js";

export { sanitizeSessionHistory, validateReplayTurns };

export const sanitizeToolsForGoogle = normalizeProviderToolSchemas;
export const logToolSchemasForGoogle = logProviderToolSchemaDiagnostics;
