import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";

const CustomerIntentCandidatesSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
});

export function createCustomerIntentCandidatesTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_list_intent_candidates",
    displaySummary: "List ranked customer intent candidates from the enterprise dossier.",
    description:
      "Return ranked intent candidates for the authenticated sender based on the customer dossier. " +
      "Current signals prefer invoices, contracts, bids, and customer-tree context. " +
      "This tool intentionally avoids weak fuzzy matching and reports only graph-backed or exact-name fallback evidence.",
    parameters: CustomerIntentCandidatesSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });

      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer intent lookup is not permitted`,
        );
      }

      const service = CustomerDataService.open();
      try {
        return jsonResult({
          intents: service.listIntentCandidates({
            channel,
            channelUserId,
          }),
        });
      } finally {
        service.close();
      }
    },
  };
}
