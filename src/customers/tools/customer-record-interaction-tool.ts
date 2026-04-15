import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";

const CustomerRecordInteractionSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
  event_type: Type.String({
    description: "Event type, e.g. 'message_inbound', 'message_outbound', 'intent_selected'",
  }),
  content_text: Type.Optional(Type.String({ description: "Optional plain-text content snippet" })),
  payload_json: Type.Optional(
    Type.String({ description: "Optional JSON payload string for structured metadata" }),
  ),
  actor_type: Type.Optional(
    Type.String({ description: "Actor type, e.g. 'customer', 'agent', 'system'" }),
  ),
  actor_id: Type.Optional(Type.String({ description: "Actor identifier override" })),
});

export function createCustomerRecordInteractionTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_record_interaction",
    displaySummary: "Record an interaction event into the enterprise customer thread store.",
    description:
      "Append an interaction event for the authenticated sender into interaction_threads and interaction_events. " +
      "Uses the customer graph when available and a synthetic customer root when graph linkage has not been completed yet.",
    parameters: CustomerRecordInteractionSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });
      const eventType = readStringParam(params, "event_type", { required: true });

      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer interaction writes are not permitted`,
        );
      }

      const service = CustomerDataService.open();
      try {
        return jsonResult(
          service.recordInteraction({
            channel,
            channelUserId,
            eventType,
            contentText: readStringParam(params, "content_text") ?? null,
            payloadJson: readStringParam(params, "payload_json") ?? null,
            actorType: readStringParam(params, "actor_type") ?? "customer",
            actorId: readStringParam(params, "actor_id") ?? channelUserId,
            createdBy: "openclaw",
          }),
        );
      } finally {
        service.close();
      }
    },
  };
}
