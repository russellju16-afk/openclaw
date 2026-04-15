import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { jsonResult, readStringParam, ToolInputError } from "../../agents/tools/common.js";
import { CustomerDataService } from "../customer-data-service.js";
import { CustomerProfileStore } from "../profile-store.js";
import type { BillingMode, DataTier, ProfileStatus } from "../profile-store.js";

const CustomerUpsertSchema = Type.Object({
  channel: Type.String({ description: "Channel type, e.g. 'wecom', 'feishu'" }),
  channel_user_id: Type.String({
    description: "Channel-specific user identifier",
  }),
  // All other fields optional — only provided fields are updated
  name: Type.Optional(Type.String({ description: "Contact name" })),
  job_title: Type.Optional(Type.String({ description: "Job title" })),
  company_name: Type.Optional(Type.String({ description: "Company name" })),
  phone: Type.Optional(Type.String({ description: "Phone number" })),
  email: Type.Optional(Type.String({ description: "Email address" })),
  kingdee_id: Type.Optional(Type.String({ description: "Kingdee ERP customer ID" })),
  kingdee_customer_name: Type.Optional(Type.String({ description: "Kingdee customer name" })),
  tax_id: Type.Optional(Type.String({ description: "Tax ID for invoicing" })),
  bank_name: Type.Optional(Type.String({ description: "Bank name for invoicing" })),
  bank_account: Type.Optional(Type.String({ description: "Bank account for invoicing" })),
  invoice_address: Type.Optional(Type.String({ description: "Invoice address" })),
  invoice_phone: Type.Optional(Type.String({ description: "Invoice phone" })),
  main_categories: Type.Optional(
    Type.String({ description: "JSON array of main product categories" }),
  ),
  monthly_volume: Type.Optional(Type.String({ description: "Monthly purchase volume" })),
  is_bidding_customer: Type.Optional(
    Type.Boolean({ description: "Whether customer participates in bidding" }),
  ),
  status: Type.Optional(
    Type.String({
      description: "Profile status: pending|confirmed|deferred|opt_out",
    }),
  ),
  data_tier: Type.Optional(
    Type.String({
      description: "Data access tier: boss|manager|staff|unknown",
    }),
  ),
  tier_confirmed: Type.Optional(
    Type.Boolean({ description: "Whether tier has been internally confirmed" }),
  ),
  verification_method: Type.Optional(
    Type.String({
      description: "How tier was verified: self_reported|feishu_group_approval|manual|phone_match",
    }),
  ),
  verified_by: Type.Optional(Type.String({ description: "Who verified the tier" })),
  opt_out_proactive: Type.Optional(Type.Boolean({ description: "Opt out of proactive messages" })),
  consent_given_at: Type.Optional(Type.String({ description: "ISO-8601 timestamp of consent" })),
  declined_fields: Type.Optional(
    Type.String({ description: "JSON array of declined field names" }),
  ),
  daily_proactive_sent_date: Type.Optional(
    Type.String({ description: "YYYY-MM-DD of last proactive message" }),
  ),
  warned_bill_ids: Type.Optional(Type.String({ description: "JSON array of warned bill IDs" })),
  onboarding_sent_at: Type.Optional(
    Type.String({ description: "ISO-8601 of onboarding message sent" }),
  ),
  next_to_ask: Type.Optional(Type.String({ description: "Next profile field to ask customer" })),
  last_complaint_date: Type.Optional(Type.String()),
  last_transfer_date: Type.Optional(Type.String()),
  last_transfer_reason: Type.Optional(Type.String()),
  pending_notifications: Type.Optional(
    Type.String({
      description:
        "JSON array of pending Feishu notifications to retry. " +
        'Each item: {"type":"complaint|dispute|transfer|other","created_at":"ISO-8601","summary":"max 500 chars","urgency":"high|medium|low"}',
    }),
  ),
  billing_entity_id: Type.Optional(
    Type.String({
      description: "ID of the linked billing entity (group company)",
    }),
  ),
  billing_mode: Type.Optional(
    Type.String({
      description:
        "Billing mode: self (own invoice info), group (use billing entity), unknown (not yet determined)",
    }),
  ),
  metadata: Type.Optional(Type.String({ description: "JSON object of additional metadata" })),
});

// Validation helpers
const VALID_STATUSES = new Set<string>(["pending", "confirmed", "deferred", "opt_out"]);
const VALID_TIERS = new Set<string>(["boss", "manager", "staff", "unknown"]);
const VALID_BILLING_MODES = new Set<string>(["self", "group", "unknown"]);

// V-02: pending_notifications validation

const VALID_NOTIFICATION_TYPES = new Set(["complaint", "dispute", "transfer", "other"]);
const VALID_NOTIFICATION_URGENCIES = new Set(["high", "medium", "low"]);
const NOTIFICATION_SUMMARY_MAX_LEN = 500;

export interface PendingNotification {
  type: "complaint" | "dispute" | "transfer" | "other";
  created_at: string;
  summary: string;
  urgency: "high" | "medium" | "low";
}

/**
 * Parse and strictly validate a raw JSON string as an array of
 * PendingNotification objects.  Unknown keys are stripped; invalid items
 * cause a ToolInputError so that injected content never reaches the DB.
 */
export function validatePendingNotifications(raw: string): PendingNotification[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolInputError("pending_notifications must be a valid JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new ToolInputError("pending_notifications must be a JSON array");
  }

  return parsed.map((item: unknown, idx: number) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ToolInputError(`pending_notifications[${idx}] must be an object`);
    }
    const obj = item as Record<string, unknown>;

    // Validate type
    if (!VALID_NOTIFICATION_TYPES.has(obj["type"] as string)) {
      throw new ToolInputError(
        `pending_notifications[${idx}].type must be one of: ${[...VALID_NOTIFICATION_TYPES].join(", ")}`,
      );
    }

    // Validate created_at (ISO-8601 basic check)
    if (typeof obj["created_at"] !== "string" || !obj["created_at"].trim()) {
      throw new ToolInputError(
        `pending_notifications[${idx}].created_at must be a non-empty string`,
      );
    }

    // Validate summary
    if (typeof obj["summary"] !== "string") {
      throw new ToolInputError(`pending_notifications[${idx}].summary must be a string`);
    }
    const summary = obj["summary"].slice(0, NOTIFICATION_SUMMARY_MAX_LEN);

    // Validate urgency
    if (!VALID_NOTIFICATION_URGENCIES.has(obj["urgency"] as string)) {
      throw new ToolInputError(
        `pending_notifications[${idx}].urgency must be one of: ${[...VALID_NOTIFICATION_URGENCIES].join(", ")}`,
      );
    }

    // Return stripped object — only allowed keys
    return {
      type: obj["type"] as PendingNotification["type"],
      created_at: obj["created_at"],
      summary,
      urgency: obj["urgency"] as PendingNotification["urgency"],
    };
  });
}

export function createCustomerUpsertTool(boundSenderId: string): AnyAgentTool {
  return {
    label: "Customer",
    name: "customer_upsert",
    displaySummary: "Create or update a customer profile.",
    description:
      "Create a new customer profile or update an existing one. " +
      "Only provided fields are updated; omitted fields retain their current values.",
    parameters: CustomerUpsertSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const channelUserId = readStringParam(params, "channel_user_id", {
        required: true,
      });

      // Sender binding: prevent cross-customer profile writes via prompt injection.
      if (channelUserId !== boundSenderId) {
        throw new ToolInputError(
          `channel_user_id '${channelUserId}' does not match the authenticated sender; ` +
            `cross-customer profile writes are not permitted`,
        );
      }

      // Validate enum fields
      const statusRaw = readStringParam(params, "status");
      if (statusRaw && !VALID_STATUSES.has(statusRaw)) {
        throw new ToolInputError(
          `Invalid status: ${statusRaw}. Must be one of: ${[...VALID_STATUSES].join(", ")}`,
        );
      }
      const dataTierRaw = readStringParam(params, "data_tier");
      if (dataTierRaw && !VALID_TIERS.has(dataTierRaw)) {
        throw new ToolInputError(
          `Invalid data_tier: ${dataTierRaw}. Must be one of: ${[...VALID_TIERS].join(", ")}`,
        );
      }
      const billingModeRaw = readStringParam(params, "billing_mode");
      if (billingModeRaw && !VALID_BILLING_MODES.has(billingModeRaw)) {
        throw new ToolInputError(
          `Invalid billing_mode: ${billingModeRaw}. Must be one of: ${[...VALID_BILLING_MODES].join(", ")}`,
        );
      }

      // V-01: Guard against prompt-injection bypass of the human tier-approval flow.
      // Only the tier_verification workflow or a manual_admin override may set
      // tier_confirmed; the customer-facing kefu agent must NOT be able to
      // self-elevate or downgrade a customer's access tier.
      // Blocks BOTH true and false — setting false would strip verification
      // from a confirmed profile, which is equally dangerous as self-elevating.
      //
      // actorRaw is intentionally hardcoded: this tool is permanently kefu-only.
      // tier_verification and manual_admin actors use separate code paths
      // (e.g. direct store.updateField calls) that bypass this tool entirely.
      // The TIER_CONFIRM_ALLOWED_ACTORS set exists as a forward-compatibility
      // guard — do NOT derive actorRaw from tool args.
      const actorRaw = "kefu";
      const TIER_CONFIRM_ALLOWED_ACTORS = new Set(["tier_verification", "manual_admin"]);
      if (
        typeof params["tier_confirmed"] === "boolean" &&
        !TIER_CONFIRM_ALLOWED_ACTORS.has(actorRaw)
      ) {
        throw new ToolInputError(
          `actor '${actorRaw}' is not permitted to write tier_confirmed; ` +
            `only tier_verification or manual_admin may change this field`,
        );
      }

      // V-01b is deferred to after the main store opens (below) to avoid
      // a second store.open() and the TOCTOU gap it creates. The tier-check
      // reuses the same `existing` snapshot that the upsert acts on.

      // V-01c: Guard trust-signal fields. verified_by and verification_method
      // are audit trail fields owned by the approval workflow.
      // Note: verified_at is not in the tool schema — it is set programmatically
      // via the isConfirmingTier path (which requires tier_confirmed=true, blocked by V-01).
      if (!TIER_CONFIRM_ALLOWED_ACTORS.has(actorRaw)) {
        const trustSignalFields = ["verified_by", "verification_method"] as const;
        for (const field of trustSignalFields) {
          if (readStringParam(params, field) != null) {
            throw new ToolInputError(
              `actor '${actorRaw}' is not permitted to write '${field}'; ` +
                `only tier_verification or manual_admin may set trust-signal fields`,
            );
          }
        }
      }

      // Parse JSON fields
      let mainCategories: string[] | null = null;
      const mainCategoriesRaw = readStringParam(params, "main_categories");
      if (mainCategoriesRaw) {
        try {
          const parsed = JSON.parse(mainCategoriesRaw);
          if (!Array.isArray(parsed) || !parsed.every((x: unknown) => typeof x === "string")) {
            throw new ToolInputError("main_categories must be a JSON array of strings");
          }
          mainCategories = parsed;
        } catch (err) {
          if (err instanceof ToolInputError) {
            throw err;
          }
          throw new ToolInputError("main_categories must be a valid JSON array of strings");
        }
      }

      let declinedFields: string[] | null = null;
      const declinedFieldsRaw = readStringParam(params, "declined_fields");
      if (declinedFieldsRaw) {
        try {
          const parsed = JSON.parse(declinedFieldsRaw);
          if (!Array.isArray(parsed) || !parsed.every((x: unknown) => typeof x === "string")) {
            throw new ToolInputError("declined_fields must be a JSON array of strings");
          }
          declinedFields = parsed;
        } catch (err) {
          if (err instanceof ToolInputError) {
            throw err;
          }
          throw new ToolInputError("declined_fields must be a valid JSON array of strings");
        }
      }

      let warnedBillIds: string[] | null = null;
      const warnedBillIdsRaw = readStringParam(params, "warned_bill_ids");
      if (warnedBillIdsRaw) {
        try {
          const parsed = JSON.parse(warnedBillIdsRaw);
          if (!Array.isArray(parsed) || !parsed.every((x: unknown) => typeof x === "string")) {
            throw new ToolInputError("warned_bill_ids must be a JSON array of strings");
          }
          warnedBillIds = parsed;
        } catch (err) {
          if (err instanceof ToolInputError) {
            throw err;
          }
          throw new ToolInputError("warned_bill_ids must be a valid JSON array of strings");
        }
      }

      let metadata: Record<string, unknown> | null = null;
      const metadataRaw = readStringParam(params, "metadata");
      if (metadataRaw) {
        try {
          const parsed = JSON.parse(metadataRaw);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new ToolInputError("metadata must be a valid JSON object");
          }
          metadata = parsed as Record<string, unknown>;
        } catch (err) {
          if (err instanceof ToolInputError) {
            throw err;
          }
          throw new ToolInputError("metadata must be a valid JSON object");
        }
      }

      // V-02: Parse and validate pending_notifications if provided.
      // validatePendingNotifications enforces a strict schema (allowed types,
      // urgency enum, 500-char summary cap, unknown-key stripping) so injected
      // content from prompt injection cannot be stored and later re-delivered
      // as a Feishu notification.
      let pendingNotificationsRaw: string | null = null;
      const pendingNotificationsParam = readStringParam(params, "pending_notifications");
      if (pendingNotificationsParam != null) {
        const validated = validatePendingNotifications(pendingNotificationsParam);
        pendingNotificationsRaw = JSON.stringify(validated);
      }

      // V-03: Strip security-sensitive metadata keys before merging.
      // These keys are owned by the approval/audit workflow and must not be
      // writable by the tool directly (doing so would let prompt injection
      // forge approval records or override access decisions).
      if (metadata != null) {
        const BLOCKED_METADATA_KEYS = new Set([
          "tier_approval_msg_id",
          "tier_approved",
          "admin_override",
          "system_override",
          "access_override",
        ]);
        const BLOCKED_METADATA_PREFIXES = ["tier_", "admin_", "system_"];
        metadata = Object.fromEntries(
          Object.entries(metadata).filter(([key]) => {
            if (BLOCKED_METADATA_KEYS.has(key)) {
              return false;
            }
            if (BLOCKED_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix))) {
              return false;
            }
            return true;
          }),
        );
      }

      // Keep the existing primary-key shape for backward compatibility, but
      // treat channel + peer as the effective lookup key in tool logic.
      const id = channelUserId;

      const store = CustomerProfileStore.open();
      const enterprise = CustomerDataService.tryOpen();
      try {
        const existing = store.getByChannelPeer(channel, channelUserId);

        // V-01b: Guard data_tier changes. Rules for kefu (non-approved actors):
        //  - Confirmed profiles: ANY tier change is blocked (prevents downgrade attack).
        //  - Existing unconfirmed: escalation blocked, downgrade allowed (customer correcting self-report).
        //  - New customers: self-report capped at "staff"; "manager"/"boss" require tier_verification.
        // Placed here (after store.open) so it reuses the same `existing` snapshot
        // the upsert will act on — eliminates the TOCTOU gap of a separate store open.
        if (dataTierRaw && !TIER_CONFIRM_ALLOWED_ACTORS.has(actorRaw)) {
          const TIER_RANK: Record<string, number> = {
            unknown: 0,
            staff: 1,
            manager: 2,
            boss: 3,
          };
          const MAX_SELF_REPORT_RANK = TIER_RANK["staff"]; // 1
          if (existing != null) {
            const existingRank = TIER_RANK[existing.dataTier ?? "unknown"] ?? 0;
            const requestedRank = TIER_RANK[dataTierRaw] ?? 0;
            if (existing.tierConfirmed) {
              // Confirmed tier: block ANY data_tier write from kefu, even same-rank.
              // Kefu should omit data_tier entirely for confirmed profiles.
              throw new ToolInputError(
                `actor '${actorRaw}' is not permitted to write data_tier ` +
                  `for a confirmed profile (current: '${existing.dataTier}'); ` +
                  `only tier_verification or manual_admin may modify a confirmed tier`,
              );
            } else if (requestedRank > existingRank) {
              // Unconfirmed existing: block escalation only.
              throw new ToolInputError(
                `actor '${actorRaw}' is not permitted to escalate data_tier from ` +
                  `'${existing.dataTier ?? "unknown"}' to '${dataTierRaw}'; ` +
                  `only tier_verification or manual_admin may raise a tier`,
              );
            }
          } else {
            // New customer: cap self-report at "staff".
            const requestedRank = TIER_RANK[dataTierRaw] ?? 0;
            if (requestedRank > MAX_SELF_REPORT_RANK) {
              throw new ToolInputError(
                `actor '${actorRaw}' may not create a profile with data_tier '${dataTierRaw}'; ` +
                  `self-reported tier is capped at 'staff'. Use tier_verification for higher tiers.`,
              );
            }
          }
        }

        const conflictingProfile = existing ? null : store.get(id);
        if (conflictingProfile && conflictingProfile.channelType !== channel) {
          throw new ToolInputError(
            `Customer ${channelUserId} already exists for channel ${conflictingProfile.channelType}; refusing to overwrite it from ${channel}`,
          );
        }

        // Compute review_due_at if tier is being confirmed for the first time
        const tierConfirmedParam = params["tier_confirmed"];
        const isConfirmingTier = tierConfirmedParam === true && !existing?.tierConfirmed;
        const now = new Date();
        const reviewDueAt = isConfirmingTier
          ? new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString()
          : (existing?.reviewDueAt ?? null);

        // Build the merged profile — only override fields that are explicitly provided
        const profile = {
          id,
          agentId: existing?.agentId ?? "",
          channelType: channel,
          channelPeerId: channelUserId,
          name: readStringParam(params, "name") ?? existing?.name ?? null,
          jobTitle: readStringParam(params, "job_title") ?? existing?.jobTitle ?? null,
          companyName: readStringParam(params, "company_name") ?? existing?.companyName ?? null,
          phone: readStringParam(params, "phone") ?? existing?.phone ?? null,
          email: readStringParam(params, "email") ?? existing?.email ?? null,
          kingdeeId: readStringParam(params, "kingdee_id") ?? existing?.kingdeeId ?? null,
          kingdeeCustomerName:
            readStringParam(params, "kingdee_customer_name") ??
            existing?.kingdeeCustomerName ??
            null,
          taxId: readStringParam(params, "tax_id") ?? existing?.taxId ?? null,
          bankName: readStringParam(params, "bank_name") ?? existing?.bankName ?? null,
          bankAccount: readStringParam(params, "bank_account") ?? existing?.bankAccount ?? null,
          invoiceAddress:
            readStringParam(params, "invoice_address") ?? existing?.invoiceAddress ?? null,
          invoicePhone: readStringParam(params, "invoice_phone") ?? existing?.invoicePhone ?? null,
          mainCategories: mainCategories ?? existing?.mainCategories ?? null,
          monthlyVolume:
            readStringParam(params, "monthly_volume") ?? existing?.monthlyVolume ?? null,
          isBiddingCustomer:
            typeof params["is_bidding_customer"] === "boolean"
              ? params["is_bidding_customer"]
              : (existing?.isBiddingCustomer ?? null),
          profileStatus: (statusRaw as ProfileStatus) ?? existing?.profileStatus ?? "pending",
          completeness: existing?.completeness ?? 0,
          declinedFields: declinedFields ?? existing?.declinedFields ?? null,
          confirmedAt: existing?.confirmedAt ?? null,
          optOutProactive:
            typeof params["opt_out_proactive"] === "boolean"
              ? params["opt_out_proactive"]
              : (existing?.optOutProactive ?? false),
          consentGivenAt:
            readStringParam(params, "consent_given_at") ?? existing?.consentGivenAt ?? null,
          lastConversationDate: now.toISOString(),
          lastArInquiryDate: existing?.lastArInquiryDate ?? null,
          quarterlyCare: existing?.quarterlyCare ?? null,
          pendingNotifications: pendingNotificationsRaw ?? existing?.pendingNotifications ?? null,
          dailyProactiveSentDate:
            readStringParam(params, "daily_proactive_sent_date") ??
            existing?.dailyProactiveSentDate ??
            null,
          warnedBillIds: warnedBillIds ?? existing?.warnedBillIds ?? null,
          onboardingSentAt:
            readStringParam(params, "onboarding_sent_at") ?? existing?.onboardingSentAt ?? null,
          nextToAsk: readStringParam(params, "next_to_ask") ?? existing?.nextToAsk ?? null,
          monthlyReconciliationSent: existing?.monthlyReconciliationSent ?? null,
          lastComplaintDate:
            readStringParam(params, "last_complaint_date") ?? existing?.lastComplaintDate ?? null,
          lastTransferDate:
            readStringParam(params, "last_transfer_date") ?? existing?.lastTransferDate ?? null,
          lastTransferReason:
            readStringParam(params, "last_transfer_reason") ?? existing?.lastTransferReason ?? null,
          // Access control fields
          dataTier: (dataTierRaw as DataTier) ?? existing?.dataTier ?? "unknown",
          accessScopes: existing?.accessScopes ?? null,
          tierConfirmed:
            typeof tierConfirmedParam === "boolean"
              ? tierConfirmedParam
              : (existing?.tierConfirmed ?? false),
          verificationMethod:
            readStringParam(params, "verification_method") ?? existing?.verificationMethod ?? null,
          verifiedBy: readStringParam(params, "verified_by") ?? existing?.verifiedBy ?? null,
          verifiedAt: isConfirmingTier ? now.toISOString() : (existing?.verifiedAt ?? null),
          reviewDueAt,
          // Billing entity linkage
          billingEntityId:
            readStringParam(params, "billing_entity_id") ?? existing?.billingEntityId ?? null,
          billingMode: (billingModeRaw as BillingMode) ?? existing?.billingMode ?? "unknown",
          // Timestamps
          createdAt: existing?.createdAt ?? now.toISOString(),
          updatedAt: now.toISOString(),
          // Metadata: shallow merge — existing keys preserved, new keys override
          metadata:
            metadata != null
              ? { ...existing?.metadata, ...metadata }
              : (existing?.metadata ?? null),
        };

        // Recalculate completeness based on merged state
        profile.completeness = store.calculateCompleteness(profile);

        // Auto-set confirmedAt / consentGivenAt when status becomes confirmed
        if (statusRaw === "confirmed") {
          if (!profile.confirmedAt) {
            profile.confirmedAt = now.toISOString();
          }
          if (!profile.consentGivenAt) {
            profile.consentGivenAt = now.toISOString();
          }
        }

        store.upsert(profile);
        const mirrored = enterprise?.upsertCustomerMirror({
          channel,
          channelUserId,
          name: profile.name,
          phone: profile.phone,
          jobTitle: profile.jobTitle,
          companyName: profile.companyName,
          taxId: profile.taxId,
          bankName: profile.bankName,
          bankAccount: profile.bankAccount,
          invoiceAddress: profile.invoiceAddress,
          invoicePhone: profile.invoicePhone,
          mainCategories: profile.mainCategories,
          kingdeeId: profile.kingdeeId,
          kingdeeCustomerName: profile.kingdeeCustomerName,
          status: profile.profileStatus,
          consentGivenAt: profile.consentGivenAt,
          onboardingSentAt: profile.onboardingSentAt,
          optOutProactive: profile.optOutProactive,
          lastConversationDate: profile.lastConversationDate,
          dailyProactiveSentDate: profile.dailyProactiveSentDate,
          nextToAsk: profile.nextToAsk,
          declinedFields: profile.declinedFields,
          notes: null,
          dataTier: profile.dataTier,
          tierConfirmed: profile.tierConfirmed,
          verificationMethod: profile.verificationMethod,
          verifiedBy: profile.verifiedBy,
          verifiedAt: profile.verifiedAt,
          reviewDueAt: profile.reviewDueAt,
          createdBy: "customer_upsert",
        });
        const resolved = enterprise?.resolveParty({
          channel,
          channelUserId,
        });

        return jsonResult({
          success: true,
          id,
          action: existing ? "updated" : "created",
          actor: "kefu",
          profile_status: profile.profileStatus,
          completeness: profile.completeness,
          data_tier: profile.dataTier,
          tier_confirmed: profile.tierConfirmed,
          billing_mode: profile.billingMode,
          billing_entity_id: profile.billingEntityId,
          enterprise_customer_id: mirrored?.id ?? null,
          party_resolution: resolved?.resolution ?? null,
          root_account_id: resolved?.rootAccountId ?? null,
          synthetic_root_account_id: resolved?.syntheticRootAccountId ?? null,
        });
      } finally {
        enterprise?.close();
        store.close();
      }
    },
  };
}
