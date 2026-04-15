import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  ToolInputError,
} from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";

const CustomerDemandSignalsSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of demand signals to return, default 10, max 20" }),
  ),
});

export function createCustomerDemandSignalsTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_list_demand_signals",
    displaySummary: "List demand and reorder signals from synced sales facts.",
    description:
      "Return per-product demand signals for the authenticated sender by bridging sales_outbound_lines into the customer graph at runtime. " +
      "Signals are derived from repeated purchase dates, quantities, and recent observed prices. " +
      "When the customer is graph-mapped, the tool uses the current party scope first and only falls back to broader context when needed.",
    parameters: CustomerDemandSignalsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });

      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer demand-signal access is not permitted`,
        );
      }

      const service = CustomerDataService.open();
      try {
        return jsonResult({
          signals: service.listDemandSignals({
            channel,
            channelUserId,
            limit: readNumberParam(params, "limit", { integer: true }) ?? 10,
          }),
        });
      } finally {
        service.close();
      }
    },
  };
}
