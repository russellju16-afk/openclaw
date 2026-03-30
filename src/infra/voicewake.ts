import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  createAsyncLock,
  readJsonFile,
  writeJsonAtomic,
} from "./json-files.js";

export type VoiceWakeConfig = {
  triggers: string[];
  /** Maps a trigger word (lowercased) to an agent ID. Triggers without a mapping use the default agent. */
  triggerAgentMap: Record<string, string>;
  updatedAtMs: number;
};

const DEFAULT_TRIGGERS = ["openclaw", "claude", "computer"];

function resolvePath(baseDir?: string) {
  const root = baseDir ?? resolveStateDir();
  return path.join(root, "settings", "voicewake.json");
}

function sanitizeTriggers(triggers: string[] | undefined | null): string[] {
  const cleaned = (triggers ?? [])
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter((w) => w.length > 0);
  return cleaned.length > 0 ? cleaned : DEFAULT_TRIGGERS;
}

function sanitizeTriggerAgentMap(
  map: Record<string, string> | undefined | null,
): Record<string, string> {
  if (!map || typeof map !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    const k = typeof key === "string" ? key.trim().toLowerCase() : "";
    const v = typeof value === "string" ? value.trim() : "";
    if (k && v) out[k] = v;
  }
  return out;
}

const withLock = createAsyncLock();

export function defaultVoiceWakeTriggers() {
  return [...DEFAULT_TRIGGERS];
}

export async function loadVoiceWakeConfig(
  baseDir?: string,
): Promise<VoiceWakeConfig> {
  const filePath = resolvePath(baseDir);
  const existing = await readJsonFile<VoiceWakeConfig>(filePath);
  if (!existing) {
    return {
      triggers: defaultVoiceWakeTriggers(),
      triggerAgentMap: {},
      updatedAtMs: 0,
    };
  }
  return {
    triggers: sanitizeTriggers(existing.triggers),
    triggerAgentMap: sanitizeTriggerAgentMap(existing.triggerAgentMap),
    updatedAtMs:
      typeof existing.updatedAtMs === "number" && existing.updatedAtMs > 0
        ? existing.updatedAtMs
        : 0,
  };
}

export async function setVoiceWakeTriggers(
  triggers: string[],
  triggerAgentMap?: Record<string, string>,
  baseDir?: string,
): Promise<VoiceWakeConfig> {
  const sanitized = sanitizeTriggers(triggers);
  const filePath = resolvePath(baseDir);
  return await withLock(async () => {
    const resolvedMap =
      triggerAgentMap !== undefined
        ? sanitizeTriggerAgentMap(triggerAgentMap)
        : (await loadVoiceWakeConfig(baseDir)).triggerAgentMap;
    const next: VoiceWakeConfig = {
      triggers: sanitized,
      triggerAgentMap: resolvedMap,
      updatedAtMs: Date.now(),
    };
    await writeJsonAtomic(filePath, next);
    return next;
  });
}
