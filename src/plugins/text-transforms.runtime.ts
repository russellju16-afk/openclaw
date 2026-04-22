import { mergePluginTextTransforms } from "../agents/plugin-text-transforms.js";
import { getActivePluginRegistry } from "./runtime.js";
import type { PluginTextTransforms } from "./types.js";

export function resolveRuntimeTextTransforms(): PluginTextTransforms | undefined {
  const registry = getActivePluginRegistry();
  const pluginTextTransforms = Array.isArray(registry?.textTransforms)
    ? registry.textTransforms.map((entry) => entry.transforms)
    : [];
  return mergePluginTextTransforms(...pluginTextTransforms);
}
