import { loadVoiceWakeConfig, setVoiceWakeTriggers } from "../../infra/voicewake.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { normalizeVoiceWakeTriggers } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

export const voicewakeHandlers: GatewayRequestHandlers = {
  "voicewake.get": async ({ respond }) => {
    try {
      const cfg = await loadVoiceWakeConfig();
      respond(true, {
        triggers: cfg.triggers,
        triggerAgentMap: cfg.triggerAgentMap,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "voicewake.set": async ({ params, respond, context }) => {
    if (!Array.isArray(params.triggers)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "voicewake.set requires triggers: string[]"),
      );
      return;
    }
    try {
      const triggers = normalizeVoiceWakeTriggers(params.triggers);
      const triggerAgentMap =
        params.triggerAgentMap && typeof params.triggerAgentMap === "object"
          ? (params.triggerAgentMap as Record<string, string>)
          : undefined;
      const cfg = await setVoiceWakeTriggers(triggers, triggerAgentMap);
      context.broadcastVoiceWakeChanged(cfg.triggers, cfg.triggerAgentMap);
      respond(true, {
        triggers: cfg.triggers,
        triggerAgentMap: cfg.triggerAgentMap,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
