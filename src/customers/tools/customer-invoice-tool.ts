// ---------------------------------------------------------------------------
// MCP tool: customer_get_invoice_info
//
// Retrieves a customer's invoice (fapiao) information.
// Gated to contacts with company_finance access scope (confirmed boss/manager).
// Bank account and phone are always masked before returning.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { authorizeCustomerAccess, getDenialMessage, type DataTier } from "../authorize-access.js";
import { CustomerDataService } from "../customer-data-service.js";
import { maskBankAccount, maskPhone } from "../pii-filter.js";
import { CustomerProfileStore } from "../profile-store.js";

const CustomerInvoiceSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
});

const FIELD_LABELS: Readonly<Record<string, string>> = {
  companyName: "公司全称",
  taxId: "纳税人识别号",
  bankName: "开户行",
  bankAccount: "银行账号",
  invoiceAddress: "注册地址",
  invoicePhone: "注册电话",
};

export function createCustomerInvoiceTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_get_invoice_info",
    displaySummary: "Query customer invoice information with access control.",
    description:
      "Retrieve a customer's invoice (fapiao) information. " +
      "Only available to contacts with company_finance access scope (boss or manager tier, confirmed). " +
      "Returns company name, tax ID, bank info, and completeness status.",
    parameters: CustomerInvoiceSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });

      // Sender binding: prevent cross-customer data access via prompt injection.
      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer invoice access is not permitted`,
        );
      }

      const store = CustomerProfileStore.open();
      const enterprise = CustomerDataService.tryOpen();
      try {
        const profile = store.getByChannelPeer(channel, channelUserId);
        const resolved = enterprise?.resolveParty({
          channel,
          channelUserId,
        });
        const enterpriseCustomer = resolved?.customer ?? null;
        const dossier = enterprise?.getCustomerDossier({
          channel,
          channelUserId,
        });

        if (!profile && !enterpriseCustomer) {
          return jsonResult({
            found: false,
            message: "Customer not found",
            channel,
            channel_user_id: channelUserId,
          });
        }

        // Resolve effective access authorization from the stored tier.
        const resolvedTier = (profile?.dataTier ??
          enterpriseCustomer?.dataTier ??
          "unknown") as DataTier;
        const auth = authorizeCustomerAccess(
          resolvedTier,
          profile?.tierConfirmed ?? enterpriseCustomer?.tierConfirmed ?? false,
          profile?.accessScopes,
        );

        if (!auth.canViewInvoiceInfo) {
          return jsonResult({
            found: true,
            authorized: false,
            message: getDenialMessage("invoice_info", resolvedTier),
            data_tier: resolvedTier,
            tier_confirmed: profile?.tierConfirmed ?? enterpriseCustomer?.tierConfirmed ?? false,
          });
        }

        // Resolve invoice data source based on billing_mode.
        // 'group' → use linked billing_entity; 'self'/'unknown' → use profile.
        let companyName = profile?.companyName ?? enterpriseCustomer?.companyName ?? null;
        let taxId = profile?.taxId ?? enterpriseCustomer?.taxId ?? null;
        let bankName = profile?.bankName ?? enterpriseCustomer?.bankName ?? null;
        let bankAccount = profile?.bankAccount ?? enterpriseCustomer?.bankAccount ?? null;
        let invoiceAddress = profile?.invoiceAddress ?? enterpriseCustomer?.invoiceAddress ?? null;
        let invoicePhone = profile?.invoicePhone ?? enterpriseCustomer?.invoicePhone ?? null;
        let billingSource: "profile" | "billing_entity" | "enterprise_customer" = profile
          ? "profile"
          : "enterprise_customer";

        if (profile?.billingMode === "group" && profile.billingEntityId) {
          const entity = store.getBillingEntity(profile.billingEntityId);
          if (entity) {
            billingSource = "billing_entity";
            companyName = entity.companyName;
            taxId = entity.taxId;
            bankName = entity.bankName;
            bankAccount = entity.bankAccount;
            invoiceAddress = entity.address;
            invoicePhone = entity.phone;
          }
        }

        // Build invoice info response — never mutate the profile.
        const invoiceInfo = {
          company_name: companyName,
          tax_id: taxId,
          bank_name: bankName,
          bank_account: bankAccount ? maskBankAccount(bankAccount) : null,
          bank_account_full_available: bankAccount != null,
          invoice_address: invoiceAddress,
          invoice_phone: invoicePhone ? maskPhone(invoicePhone) : null,
        };

        // Completeness check: basic VAT invoice requires companyName + taxId.
        const missingRequired = [
          ...(!companyName?.trim() ? ["companyName"] : []),
          ...(!taxId?.trim() ? ["taxId"] : []),
        ];
        // Special (增值税专用) VAT invoice also requires bank info.
        const missingForSpecialVat = [
          ...(!bankName?.trim() ? ["bankName"] : []),
          ...(!bankAccount?.trim() ? ["bankAccount"] : []),
          ...(!invoiceAddress?.trim() ? ["invoiceAddress"] : []),
          ...(!invoicePhone?.trim() ? ["invoicePhone"] : []),
        ];

        return jsonResult({
          found: true,
          authorized: true,
          billing_mode: profile?.billingMode ?? "unknown",
          billing_source: billingSource,
          billing_entity_id: profile?.billingEntityId ?? null,
          party_resolution: resolved?.resolution ?? null,
          root_account_id: resolved?.rootAccountId ?? null,
          current_party_id: resolved?.currentPartyId ?? null,
          invoice_artifact_count: dossier?.artifactSummary.invoices ?? 0,
          latest_invoice_number: dossier?.invoices[0]?.title ?? null,
          latest_invoice_date: dossier?.invoices[0]?.date ?? null,
          invoice_info: invoiceInfo,
          complete: missingRequired.length === 0,
          missing_required: missingRequired.map((f) => FIELD_LABELS[f] ?? f),
          missing_for_special_vat: missingForSpecialVat.map((f) => FIELD_LABELS[f] ?? f),
        });
      } finally {
        enterprise?.close();
        store.close();
      }
    },
  };
}
