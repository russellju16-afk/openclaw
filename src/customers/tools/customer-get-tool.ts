// ---------------------------------------------------------------------------
// MCP tool: customer_get
//
// Retrieves a customer profile by channel + channel_user_id.
// Applies tier-based access control via authorizeCustomerAccess() and masks
// PII fields (phone, bank account) before returning data to the agent.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { authorizeCustomerAccess, type DataTier } from "../authorize-access.js";
import { CustomerDataService } from "../customer-data-service.js";
import { maskBankAccount, maskPhone } from "../pii-filter.js";
import { CustomerProfileStore } from "../profile-store.js";

const CustomerGetSchema = Type.Object({
  channel: Type.String({
    description: "Channel type, e.g. 'wecom', 'feishu'",
  }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier (peer id)",
  }),
});

export function createCustomerGetTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_get",
    displaySummary: "Query customer profile with tier-based access control.",
    description:
      "Retrieve a customer profile by channel and user ID. " +
      "Returns profile data filtered by the customer's verified access tier. " +
      "Sensitive financial fields (invoice info, AR data) are only included " +
      "for confirmed boss/manager tier contacts with company_finance scope.",
    parameters: CustomerGetSchema,
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
            `cross-customer profile access is not permitted`,
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
        const demandSignals = enterprise?.listDemandSignals({
          channel,
          channelUserId,
          limit: 3,
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

        const profileStatus = profile?.profileStatus ?? enterpriseCustomer?.status ?? "pending";
        const companyName = profile?.companyName ?? enterpriseCustomer?.companyName ?? null;
        const jobTitle = profile?.jobTitle ?? enterpriseCustomer?.jobTitle ?? null;
        const phone = profile?.phone ?? enterpriseCustomer?.phone ?? null;
        const name = profile?.name ?? enterpriseCustomer?.name ?? null;
        const mainCategories =
          profile?.mainCategories ?? enterpriseCustomer?.mainCategories ?? null;
        const monthlyVolume =
          profile?.monthlyVolume ??
          (enterpriseCustomer?.monthlyAvgAmount != null
            ? String(enterpriseCustomer.monthlyAvgAmount)
            : null);
        const kingdeeId = profile?.kingdeeId ?? enterpriseCustomer?.kingdeeId ?? null;
        const kingdeeCustomerName =
          profile?.kingdeeCustomerName ?? enterpriseCustomer?.kingdeeCustomerName ?? null;
        const declinedFields =
          profile?.declinedFields ?? enterpriseCustomer?.declinedFields ?? null;
        const nextToAsk = profile?.nextToAsk ?? enterpriseCustomer?.nextToAsk ?? null;
        const verificationMethod =
          profile?.verificationMethod ?? enterpriseCustomer?.verificationMethod ?? null;
        const verifiedAt = profile?.verifiedAt ?? enterpriseCustomer?.verifiedAt ?? null;
        const reviewDueAt = profile?.reviewDueAt ?? enterpriseCustomer?.reviewDueAt ?? null;

        // Build response with tier-appropriate field visibility.
        // Construct a new object — never mutate the profile.
        const response: Record<string, unknown> = {
          found: true,

          // Identity
          id: profile?.id ?? enterpriseCustomer?.id ?? channelUserId,
          channel_type: channel,
          channel_peer_id: channelUserId,

          // Basic contact info (always visible, phone masked)
          name,
          company_name: companyName,
          job_title: jobTitle,
          phone: phone ? maskPhone(phone) : null,
          email: profile?.email ?? null,

          // Profile lifecycle
          profile_status: profileStatus,
          completeness: profile?.completeness ?? 0,

          // Access control metadata
          data_tier: resolvedTier,
          tier_confirmed: profile?.tierConfirmed ?? enterpriseCustomer?.tierConfirmed ?? false,
          effective_scopes: auth.scopes,
          can_query_ar: auth.canQueryAR,
          can_query_all_orders: auth.canQueryAllOrders,
          can_view_invoice_info: auth.canViewInvoiceInfo,

          // Purchase preferences (always visible)
          main_categories: mainCategories,
          monthly_volume: monthlyVolume,
          is_bidding_customer: profile?.isBiddingCustomer ?? null,

          // Kingdee ERP linkage (always visible)
          kingdee_id: kingdeeId,
          kingdee_customer_name: kingdeeCustomerName,

          // Lifecycle timestamps
          last_conversation_date:
            profile?.lastConversationDate ?? enterpriseCustomer?.lastConversationDate ?? null,
          opt_out_proactive: profile?.optOutProactive ?? false,
          consent_given_at: profile?.consentGivenAt ?? null,

          // Proactive messaging state
          daily_proactive_sent_date: profile?.dailyProactiveSentDate ?? null,
          next_to_ask: nextToAsk,
          declined_fields: declinedFields,
          onboarding_sent_at: profile?.onboardingSentAt ?? null,

          // Verification metadata
          verification_method: verificationMethod,
          verified_at: verifiedAt,
          review_due_at: reviewDueAt,

          // Enterprise graph context
          party_resolution: resolved?.resolution ?? null,
          matched_by: resolved?.matchedBy ?? null,
          root_account_id: resolved?.rootAccountId ?? null,
          synthetic_root_account_id: resolved?.syntheticRootAccountId ?? null,
          current_party_id: resolved?.currentPartyId ?? null,
          current_party_name: resolved?.party?.displayName ?? resolved?.party?.name ?? null,
          current_party_type: resolved?.party?.nodeType ?? null,

          // Dossier rollup
          dossier_available: dossier != null,
          party_count: dossier?.parties.length ?? 0,
          related_customer_count: dossier?.relatedCustomers.length ?? 0,
          artifact_summary: dossier?.artifactSummary ?? {
            invoices: 0,
            documents: 0,
          },
          latest_invoice_number: dossier?.invoices[0]?.title ?? null,
          latest_invoice_date: dossier?.invoices[0]?.date ?? null,
          top_demand_signals:
            demandSignals?.map((signal) => ({
              material_id: signal.materialId,
              material_name: signal.materialName,
              predicted_reorder_at: signal.predictedReorderAt,
              predicted_reorder_qty: signal.predictedReorderQty,
              confidence: signal.confidence,
              confidence_band: signal.confidenceBand,
            })) ?? [],
        };

        // Invoice info: only for confirmed boss/manager (company_finance scope).
        if (auth.canViewInvoiceInfo) {
          const taxId = profile?.taxId ?? enterpriseCustomer?.taxId ?? null;
          const bankName = profile?.bankName ?? enterpriseCustomer?.bankName ?? null;
          const bankAccount = profile?.bankAccount ?? enterpriseCustomer?.bankAccount ?? null;
          const invoiceAddress =
            profile?.invoiceAddress ?? enterpriseCustomer?.invoiceAddress ?? null;
          const invoicePhone = profile?.invoicePhone ?? enterpriseCustomer?.invoicePhone ?? null;

          response.tax_id = taxId;
          response.bank_name = bankName;
          response.bank_account = bankAccount ? maskBankAccount(bankAccount) : null;
          response.invoice_address = invoiceAddress;
          response.invoice_phone = invoicePhone ? maskPhone(invoicePhone) : null;
        }

        // AR tracking: only for company_finance scope.
        if (auth.canQueryAR) {
          response.last_ar_inquiry_date = profile?.lastArInquiryDate ?? null;
        }

        return jsonResult(response);
      } finally {
        enterprise?.close();
        store.close();
      }
    },
  };
}
