import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  ToolInputError,
} from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";

const CustomerSafePricingSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
  product_id: Type.Optional(
    Type.String({ description: "Exact product id from the products table" }),
  ),
  query: Type.Optional(
    Type.String({ description: "Product search query, e.g. '大米', '西瑞一级大豆油'" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max products to return, default 10, max 20" })),
});

export function createCustomerSafePricingTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_get_safe_pricing",
    displaySummary: "Query safe customer-facing pricing from the enterprise product catalog.",
    description:
      "Return customer-safe pricing candidates for the authenticated sender. " +
      "Current implementation uses the products catalog public baseline (avg_price) and intentionally avoids unverified party-specific commercial terms until those tables are present.",
    parameters: CustomerSafePricingSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", { required: true });

      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer pricing access is not permitted`,
        );
      }

      const productId = readStringParam(params, "product_id") ?? null;
      const query = readStringParam(params, "query") ?? null;
      if (!productId && !query) {
        throw new ToolInputError("product_id or query required");
      }

      const service = CustomerDataService.open();
      try {
        return jsonResult(
          service.getCustomerSafePricing({
            channel,
            channelUserId,
            productId,
            query,
            limit: readNumberParam(params, "limit", { integer: true }) ?? 10,
          }),
        );
      } finally {
        service.close();
      }
    },
  };
}
