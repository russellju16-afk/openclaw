import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";

const CustomerDossierSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
});

export function createCustomerDossierTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_get_dossier",
    displaySummary: "Query the unified customer dossier from the enterprise database.",
    description:
      "Resolve the authenticated sender into the customer graph and return a unified dossier. " +
      "Includes party tree, linked artifacts, related customer rows, contacts, and locations. " +
      "Uses graph resolution first and falls back to customer-only context when no party is linked yet.",
    parameters: CustomerDossierSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });

      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer dossier access is not permitted`,
        );
      }

      const service = CustomerDataService.open();
      try {
        return jsonResult(
          service.getCustomerDossier({
            channel,
            channelUserId,
          }),
        );
      } finally {
        service.close();
      }
    },
  };
}
