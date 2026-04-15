import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveCustomerProfilesSqlitePath } from "./profile-store.paths.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProfileStatus = "pending" | "confirmed" | "deferred" | "opt_out";

export type DataTier = "boss" | "manager" | "staff" | "unknown";

export type DataAccessScope =
  | "public" // 产品目录、库存、公开价格
  | "self_orders" // 自己经手的订单和物流
  | "company_ops" // 公司全部订单、采购历史
  | "company_finance"; // 应收账款、信用额度、对账单、发票

export type BillingMode = "self" | "group" | "unknown";

export interface BillingEntity {
  id: string;
  companyName: string;
  taxId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  address: string | null;
  phone: string | null;
  kingdeeGroupName: string | null;
  source: string; // "manual" | "kingdee_sync" | "customer_reported"
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfile {
  /** Primary key — WeCom external_userid or channel peer id */
  id: string;
  /** Dynamic agent id this profile is associated with */
  agentId: string;

  // Source channel
  channelType: string;
  channelPeerId: string;

  // Basic contact info
  name: string | null;
  jobTitle: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;

  // Kingdee ERP linkage
  kingdeeId: string | null;
  kingdeeCustomerName: string | null;

  // Invoice (fapiao) info
  taxId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  invoiceAddress: string | null;
  invoicePhone: string | null;

  // Purchase preferences
  mainCategories: string[] | null;
  monthlyVolume: string | null;
  isBiddingCustomer: boolean | null;

  // Profile lifecycle
  profileStatus: ProfileStatus;
  /** 0-1 completeness score */
  completeness: number;
  /** Fields the customer explicitly declined to provide */
  declinedFields: string[] | null;
  confirmedAt: string | null;

  // Timestamps (ISO-8601)
  createdAt: string;
  updatedAt: string;

  // Tracking fields (operational, not counted in completeness)
  optOutProactive: boolean;
  consentGivenAt: string | null;
  lastConversationDate: string | null;
  lastArInquiryDate: string | null;
  quarterlyCare: string | null; // e.g. "2026-Q2"
  pendingNotifications: string | null; // JSON array

  // Proactive messaging tracking
  dailyProactiveSentDate: string | null; // "YYYY-MM-DD"
  warnedBillIds: string[] | null; // JSON array of bill IDs already warned
  onboardingSentAt: string | null; // ISO-8601, set after onboarding msg sent
  nextToAsk: string | null; // next profile field to ask customer
  monthlyReconciliationSent: string | null; // "YYYY-MM", tracks last month reconciliation was sent

  // Complaint / transfer tracking
  lastComplaintDate: string | null;
  lastTransferDate: string | null;
  lastTransferReason: string | null;

  // Access control
  dataTier: DataTier;
  accessScopes: DataAccessScope[] | null; // JSON array, null = derive from tier
  tierConfirmed: boolean;
  verificationMethod: string | null; // "phone_match" | "order_history" | "manual" | null
  verifiedBy: string | null; // 确认人标识
  verifiedAt: string | null; // ISO-8601
  reviewDueAt: string | null; // ISO-8601, 下次复核时间

  // Billing entity linkage
  billingEntityId: string | null;
  billingMode: BillingMode;

  // Freeform extension bag
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Internal row type (DB <-> JS boundary)
// ---------------------------------------------------------------------------

type ProfileRow = {
  id: string;
  agent_id: string;
  channel_type: string;
  channel_peer_id: string;
  name: string | null;
  job_title: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  kingdee_id: string | null;
  kingdee_customer_name: string | null;
  tax_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  invoice_address: string | null;
  invoice_phone: string | null;
  main_categories: string | null; // JSON array
  monthly_volume: string | null;
  is_bidding_customer: number | null; // 0 | 1 | null
  profile_status: string;
  completeness: number;
  declined_fields: string | null; // JSON array
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  opt_out_proactive: number; // 0 | 1
  consent_given_at: string | null;
  last_conversation_date: string | null;
  last_ar_inquiry_date: string | null;
  quarterly_care: string | null;
  pending_notifications: string | null; // JSON array
  daily_proactive_sent_date: string | null;
  warned_bill_ids: string | null; // JSON array
  onboarding_sent_at: string | null;
  next_to_ask: string | null;
  monthly_reconciliation_sent: string | null;
  last_complaint_date: string | null;
  last_transfer_date: string | null;
  last_transfer_reason: string | null;
  data_tier: string; // "boss" | "manager" | "staff" | "unknown"
  access_scopes: string | null; // JSON array
  tier_confirmed: number; // 0 | 1
  verification_method: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_due_at: string | null;
  billing_entity_id: string | null;
  billing_mode: string; // "self" | "group" | "unknown"
  metadata: string | null; // JSON object
};

type BillingEntityRow = {
  id: string;
  company_name: string;
  tax_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  address: string | null;
  phone: string | null;
  kingdee_group_name: string | null;
  source: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToBillingEntity(row: BillingEntityRow): BillingEntity {
  return {
    id: row.id,
    companyName: row.company_name,
    taxId: row.tax_id,
    bankName: row.bank_name,
    bankAccount: row.bank_account,
    address: row.address,
    phone: row.phone,
    kingdeeGroupName: row.kingdee_group_name,
    source: row.source,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function parseJsonArray(raw: string | null, fieldName?: string): string[] | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error(
      `[CustomerProfileStore] JSON parse failure for field "${fieldName ?? "unknown"}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function parseJsonObject(raw: string | null, fieldName?: string): Record<string, unknown> | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (err) {
    console.error(
      `[CustomerProfileStore] JSON parse failure for field "${fieldName ?? "unknown"}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function boolToInt(value: boolean | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return value ? 1 : 0;
}

function intToBool(value: number | null): boolean | null {
  if (value == null) {
    return null;
  }
  return value !== 0;
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

function rowToProfile(row: ProfileRow): CustomerProfile {
  return {
    id: row.id,
    agentId: row.agent_id,
    channelType: row.channel_type,
    channelPeerId: row.channel_peer_id,
    name: row.name,
    jobTitle: row.job_title,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    kingdeeId: row.kingdee_id,
    kingdeeCustomerName: row.kingdee_customer_name,
    taxId: row.tax_id,
    bankName: row.bank_name,
    bankAccount: row.bank_account,
    invoiceAddress: row.invoice_address,
    invoicePhone: row.invoice_phone,
    mainCategories: parseJsonArray(row.main_categories, "main_categories"),
    monthlyVolume: row.monthly_volume,
    isBiddingCustomer: intToBool(row.is_bidding_customer),
    profileStatus: row.profile_status as ProfileStatus,
    completeness: row.completeness,
    declinedFields: parseJsonArray(row.declined_fields, "declined_fields"),
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    optOutProactive: row.opt_out_proactive !== 0,
    consentGivenAt: row.consent_given_at,
    lastConversationDate: row.last_conversation_date,
    lastArInquiryDate: row.last_ar_inquiry_date,
    quarterlyCare: row.quarterly_care,
    pendingNotifications: row.pending_notifications,
    dailyProactiveSentDate: row.daily_proactive_sent_date,
    warnedBillIds: parseJsonArray(row.warned_bill_ids, "warned_bill_ids"),
    onboardingSentAt: row.onboarding_sent_at,
    nextToAsk: row.next_to_ask,
    monthlyReconciliationSent: row.monthly_reconciliation_sent,
    lastComplaintDate: row.last_complaint_date,
    lastTransferDate: row.last_transfer_date,
    lastTransferReason: row.last_transfer_reason,
    dataTier: (row.data_tier as DataTier) || "unknown",
    accessScopes: parseJsonArray(row.access_scopes, "access_scopes") as DataAccessScope[] | null,
    tierConfirmed: row.tier_confirmed !== 0,
    verificationMethod: row.verification_method,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    reviewDueAt: row.review_due_at,
    billingEntityId: row.billing_entity_id,
    billingMode: (row.billing_mode as BillingMode) || "unknown",
    metadata: parseJsonObject(row.metadata, "metadata"),
  };
}

function profileToBindParams(
  profile: Partial<CustomerProfile> & { id: string },
  now: string,
): ProfileRow {
  return {
    id: profile.id,
    agent_id: profile.agentId ?? "",
    channel_type: profile.channelType ?? "",
    channel_peer_id: profile.channelPeerId ?? "",
    name: profile.name ?? null,
    job_title: profile.jobTitle ?? null,
    company_name: profile.companyName ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
    kingdee_id: profile.kingdeeId ?? null,
    kingdee_customer_name: profile.kingdeeCustomerName ?? null,
    tax_id: profile.taxId ?? null,
    bank_name: profile.bankName ?? null,
    bank_account: profile.bankAccount ?? null,
    invoice_address: profile.invoiceAddress ?? null,
    invoice_phone: profile.invoicePhone ?? null,
    main_categories: serializeJson(profile.mainCategories),
    monthly_volume: profile.monthlyVolume ?? null,
    is_bidding_customer: boolToInt(profile.isBiddingCustomer),
    profile_status: profile.profileStatus ?? "pending",
    completeness: profile.completeness ?? 0,
    declined_fields: serializeJson(profile.declinedFields),
    confirmed_at: profile.confirmedAt ?? null,
    created_at: profile.createdAt ?? now,
    updated_at: now,
    opt_out_proactive: profile.optOutProactive ? 1 : 0,
    consent_given_at: profile.consentGivenAt ?? null,
    last_conversation_date: profile.lastConversationDate ?? null,
    last_ar_inquiry_date: profile.lastArInquiryDate ?? null,
    quarterly_care: profile.quarterlyCare ?? null,
    pending_notifications: profile.pendingNotifications ?? null,
    daily_proactive_sent_date: profile.dailyProactiveSentDate ?? null,
    warned_bill_ids: serializeJson(profile.warnedBillIds),
    onboarding_sent_at: profile.onboardingSentAt ?? null,
    next_to_ask: profile.nextToAsk ?? null,
    monthly_reconciliation_sent: profile.monthlyReconciliationSent ?? null,
    last_complaint_date: profile.lastComplaintDate ?? null,
    last_transfer_date: profile.lastTransferDate ?? null,
    last_transfer_reason: profile.lastTransferReason ?? null,
    data_tier: profile.dataTier ?? "unknown",
    access_scopes: serializeJson(profile.accessScopes),
    tier_confirmed: profile.tierConfirmed ? 1 : 0,
    verification_method: profile.verificationMethod ?? null,
    verified_by: profile.verifiedBy ?? null,
    verified_at: profile.verifiedAt ?? null,
    review_due_at: profile.reviewDueAt ?? null,
    billing_entity_id: profile.billingEntityId ?? null,
    billing_mode: profile.billingMode ?? "unknown",
    metadata: serializeJson(profile.metadata),
  };
}

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

const DB_DIR_MODE = 0o700;
const DB_FILE_MODE = 0o600;
const DB_SIDECAR_SUFFIXES = ["", "-shm", "-wal"] as const;

function ensureSchema(db: DatabaseSync): void {
  // Billing entities table (group company invoicing)
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS billing_entities (
      id                    TEXT PRIMARY KEY,
      company_name          TEXT NOT NULL,
      tax_id                TEXT,
      bank_name             TEXT,
      bank_account          TEXT,
      address               TEXT,
      phone                 TEXT,
      kingdee_group_name    TEXT,
      source                TEXT NOT NULL DEFAULT 'manual',
      verified_at           TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    )
  `,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_be_kingdee_group ON billing_entities(kingdee_group_name)`,
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_be_company_name ON billing_entities(company_name)`,
  ).run();

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS customer_profiles (
      id                    TEXT PRIMARY KEY,
      agent_id              TEXT NOT NULL,
      channel_type          TEXT NOT NULL,
      channel_peer_id       TEXT NOT NULL,
      name                  TEXT,
      job_title             TEXT,
      company_name          TEXT,
      phone                 TEXT,
      email                 TEXT,
      kingdee_id            TEXT,
      kingdee_customer_name TEXT,
      tax_id                TEXT,
      bank_name             TEXT,
      bank_account          TEXT,
      invoice_address       TEXT,
      invoice_phone         TEXT,
      main_categories       TEXT,
      monthly_volume        TEXT,
      is_bidding_customer   INTEGER,
      profile_status        TEXT NOT NULL DEFAULT 'pending',
      completeness          REAL NOT NULL DEFAULT 0,
      declined_fields       TEXT,
      confirmed_at          TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      opt_out_proactive     INTEGER NOT NULL DEFAULT 0,
      consent_given_at      TEXT,
      last_conversation_date TEXT,
      last_ar_inquiry_date  TEXT,
      quarterly_care        TEXT,
      pending_notifications TEXT,
      daily_proactive_sent_date TEXT,
      warned_bill_ids       TEXT,
      onboarding_sent_at    TEXT,
      next_to_ask           TEXT,
      monthly_reconciliation_sent TEXT,
      last_complaint_date   TEXT,
      last_transfer_date    TEXT,
      last_transfer_reason  TEXT,
      data_tier             TEXT NOT NULL DEFAULT 'unknown',
      access_scopes         TEXT,
      tier_confirmed        INTEGER NOT NULL DEFAULT 0,
      verification_method   TEXT,
      verified_by           TEXT,
      verified_at           TEXT,
      review_due_at         TEXT,
      billing_entity_id     TEXT REFERENCES billing_entities(id),
      billing_mode          TEXT NOT NULL DEFAULT 'unknown',
      metadata              TEXT
    )
  `,
  ).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cp_agent_id ON customer_profiles(agent_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cp_kingdee_id ON customer_profiles(kingdee_id)`).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_cp_profile_status ON customer_profiles(profile_status)`,
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_cp_company_name ON customer_profiles(company_name)`,
  ).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cp_data_tier ON customer_profiles(data_tier)`).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_cp_channel_peer ON customer_profiles(channel_type, channel_peer_id)`,
  ).run();

  // Migration: add access control columns to existing databases
  const migrationColumns = [
    ["data_tier", "TEXT NOT NULL DEFAULT 'unknown'"],
    ["access_scopes", "TEXT"],
    ["tier_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["verification_method", "TEXT"],
    ["verified_by", "TEXT"],
    ["verified_at", "TEXT"],
    ["review_due_at", "TEXT"],
    ["monthly_reconciliation_sent", "TEXT"],
    ["billing_entity_id", "TEXT REFERENCES billing_entities(id)"],
    ["billing_mode", "TEXT NOT NULL DEFAULT 'unknown'"],
  ] as const;

  for (const [col, typedef] of migrationColumns) {
    try {
      db.prepare(`ALTER TABLE customer_profiles ADD COLUMN ${col} ${typedef}`).run();
    } catch (err) {
      // Only ignore the "column already exists" error; propagate real failures.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already has a column named") && !msg.includes("duplicate column name")) {
        throw new Error(
          `Migration failed: could not add column "${col}" to customer_profiles: ${msg}`,
          { cause: err },
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Prepared statements type
// ---------------------------------------------------------------------------

type ProfileStatements = {
  upsert: StatementSync;
  selectById: StatementSync;
  selectByChannelPeer: StatementSync;
  selectByAgentId: StatementSync;
  selectByKingdeeId: StatementSync;
  selectAll: StatementSync;
  selectByStatus: StatementSync;
  selectWithKingdeeId: StatementSync;
  selectByStatusWithKingdeeId: StatementSync;
  // Billing entity statements
  beUpsert: StatementSync;
  beSelectById: StatementSync;
  beSelectByGroupName: StatementSync;
  beSelectByCompanyName: StatementSync;
  beSelectAll: StatementSync;
  selectByBillingEntityId: StatementSync;
};

function createStatements(db: DatabaseSync): ProfileStatements {
  return {
    upsert: db.prepare(`
      INSERT INTO customer_profiles (
        id, agent_id, channel_type, channel_peer_id,
        name, job_title, company_name, phone, email,
        kingdee_id, kingdee_customer_name,
        tax_id, bank_name, bank_account, invoice_address, invoice_phone,
        main_categories, monthly_volume, is_bidding_customer,
        profile_status, completeness, declined_fields, confirmed_at,
        created_at, updated_at,
        opt_out_proactive, consent_given_at, last_conversation_date,
        last_ar_inquiry_date, quarterly_care, pending_notifications,
        daily_proactive_sent_date, warned_bill_ids, onboarding_sent_at,
        next_to_ask, monthly_reconciliation_sent,
        last_complaint_date, last_transfer_date, last_transfer_reason,
        data_tier, access_scopes, tier_confirmed,
        verification_method, verified_by, verified_at, review_due_at,
        billing_entity_id, billing_mode, metadata
      ) VALUES (
        @id, @agent_id, @channel_type, @channel_peer_id,
        @name, @job_title, @company_name, @phone, @email,
        @kingdee_id, @kingdee_customer_name,
        @tax_id, @bank_name, @bank_account, @invoice_address, @invoice_phone,
        @main_categories, @monthly_volume, @is_bidding_customer,
        @profile_status, @completeness, @declined_fields, @confirmed_at,
        @created_at, @updated_at,
        @opt_out_proactive, @consent_given_at, @last_conversation_date,
        @last_ar_inquiry_date, @quarterly_care, @pending_notifications,
        @daily_proactive_sent_date, @warned_bill_ids, @onboarding_sent_at,
        @next_to_ask, @monthly_reconciliation_sent,
        @last_complaint_date, @last_transfer_date, @last_transfer_reason,
        @data_tier, @access_scopes, @tier_confirmed,
        @verification_method, @verified_by, @verified_at, @review_due_at,
        @billing_entity_id, @billing_mode, @metadata
      )
      ON CONFLICT(id) DO UPDATE SET
        agent_id               = excluded.agent_id,
        channel_type           = excluded.channel_type,
        channel_peer_id        = excluded.channel_peer_id,
        name                   = excluded.name,
        job_title              = excluded.job_title,
        company_name           = excluded.company_name,
        phone                  = excluded.phone,
        email                  = excluded.email,
        kingdee_id             = excluded.kingdee_id,
        kingdee_customer_name  = excluded.kingdee_customer_name,
        tax_id                 = excluded.tax_id,
        bank_name              = excluded.bank_name,
        bank_account           = excluded.bank_account,
        invoice_address        = excluded.invoice_address,
        invoice_phone          = excluded.invoice_phone,
        main_categories        = excluded.main_categories,
        monthly_volume         = excluded.monthly_volume,
        is_bidding_customer    = excluded.is_bidding_customer,
        profile_status         = excluded.profile_status,
        completeness           = excluded.completeness,
        declined_fields        = excluded.declined_fields,
        confirmed_at           = excluded.confirmed_at,
        updated_at             = excluded.updated_at,
        opt_out_proactive      = excluded.opt_out_proactive,
        consent_given_at       = excluded.consent_given_at,
        last_conversation_date = excluded.last_conversation_date,
        last_ar_inquiry_date   = excluded.last_ar_inquiry_date,
        quarterly_care         = excluded.quarterly_care,
        pending_notifications  = excluded.pending_notifications,
        daily_proactive_sent_date = excluded.daily_proactive_sent_date,
        warned_bill_ids        = excluded.warned_bill_ids,
        onboarding_sent_at     = excluded.onboarding_sent_at,
        next_to_ask            = excluded.next_to_ask,
        monthly_reconciliation_sent = excluded.monthly_reconciliation_sent,
        last_complaint_date    = excluded.last_complaint_date,
        last_transfer_date     = excluded.last_transfer_date,
        last_transfer_reason   = excluded.last_transfer_reason,
        data_tier              = excluded.data_tier,
        access_scopes          = excluded.access_scopes,
        tier_confirmed         = excluded.tier_confirmed,
        verification_method    = excluded.verification_method,
        verified_by            = excluded.verified_by,
        verified_at            = excluded.verified_at,
        review_due_at          = excluded.review_due_at,
        billing_entity_id      = excluded.billing_entity_id,
        billing_mode           = excluded.billing_mode,
        metadata               = excluded.metadata
    `),
    selectById: db.prepare(`SELECT * FROM customer_profiles WHERE id = ?`),
    selectByChannelPeer: db.prepare(
      `SELECT * FROM customer_profiles WHERE channel_type = ? AND channel_peer_id = ? LIMIT 1`,
    ),
    selectByAgentId: db.prepare(`SELECT * FROM customer_profiles WHERE agent_id = ? LIMIT 1`),
    selectByKingdeeId: db.prepare(`SELECT * FROM customer_profiles WHERE kingdee_id = ? LIMIT 1`),
    selectAll: db.prepare(`SELECT * FROM customer_profiles ORDER BY updated_at DESC`),
    selectByStatus: db.prepare(
      `SELECT * FROM customer_profiles WHERE profile_status = ? ORDER BY updated_at DESC`,
    ),
    selectWithKingdeeId: db.prepare(
      `SELECT * FROM customer_profiles WHERE kingdee_id IS NOT NULL ORDER BY updated_at DESC`,
    ),
    selectByStatusWithKingdeeId: db.prepare(
      `SELECT * FROM customer_profiles WHERE profile_status = ? AND kingdee_id IS NOT NULL ORDER BY updated_at DESC`,
    ),
    // Billing entity statements
    beUpsert: db.prepare(`
      INSERT INTO billing_entities (
        id, company_name, tax_id, bank_name, bank_account,
        address, phone, kingdee_group_name, source,
        verified_at, created_at, updated_at
      ) VALUES (
        @id, @company_name, @tax_id, @bank_name, @bank_account,
        @address, @phone, @kingdee_group_name, @source,
        @verified_at, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        company_name       = excluded.company_name,
        tax_id             = excluded.tax_id,
        bank_name          = excluded.bank_name,
        bank_account       = excluded.bank_account,
        address            = excluded.address,
        phone              = excluded.phone,
        kingdee_group_name = excluded.kingdee_group_name,
        source             = excluded.source,
        verified_at        = excluded.verified_at,
        updated_at         = excluded.updated_at
    `),
    beSelectById: db.prepare(`SELECT * FROM billing_entities WHERE id = ?`),
    beSelectByGroupName: db.prepare(
      `SELECT * FROM billing_entities WHERE kingdee_group_name = ? LIMIT 1`,
    ),
    beSelectByCompanyName: db.prepare(
      `SELECT * FROM billing_entities WHERE company_name = ? LIMIT 1`,
    ),
    beSelectAll: db.prepare(`SELECT * FROM billing_entities ORDER BY updated_at DESC`),
    selectByBillingEntityId: db.prepare(
      `SELECT * FROM customer_profiles WHERE billing_entity_id = ? ORDER BY updated_at DESC`,
    ),
  };
}

// ---------------------------------------------------------------------------
// CustomerProfileStore
// ---------------------------------------------------------------------------

/** Fields that contribute to the completeness score (equal weight). */
const COMPLETENESS_FIELDS: ReadonlyArray<keyof CustomerProfile> = [
  "name",
  "companyName",
  "phone",
  "email",
  "jobTitle",
  "kingdeeId",
  "taxId",
  "bankName",
  "bankAccount",
  "invoiceAddress",
  "invoicePhone",
  "mainCategories",
  "monthlyVolume",
];

/** Mapping from CustomerProfile field name to SQLite column name. */
const FIELD_TO_COLUMN: Record<keyof CustomerProfile, string> = {
  id: "id",
  agentId: "agent_id",
  channelType: "channel_type",
  channelPeerId: "channel_peer_id",
  name: "name",
  jobTitle: "job_title",
  companyName: "company_name",
  phone: "phone",
  email: "email",
  kingdeeId: "kingdee_id",
  kingdeeCustomerName: "kingdee_customer_name",
  taxId: "tax_id",
  bankName: "bank_name",
  bankAccount: "bank_account",
  invoiceAddress: "invoice_address",
  invoicePhone: "invoice_phone",
  mainCategories: "main_categories",
  monthlyVolume: "monthly_volume",
  isBiddingCustomer: "is_bidding_customer",
  profileStatus: "profile_status",
  completeness: "completeness",
  declinedFields: "declined_fields",
  confirmedAt: "confirmed_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  optOutProactive: "opt_out_proactive",
  consentGivenAt: "consent_given_at",
  lastConversationDate: "last_conversation_date",
  lastArInquiryDate: "last_ar_inquiry_date",
  quarterlyCare: "quarterly_care",
  pendingNotifications: "pending_notifications",
  dailyProactiveSentDate: "daily_proactive_sent_date",
  warnedBillIds: "warned_bill_ids",
  onboardingSentAt: "onboarding_sent_at",
  nextToAsk: "next_to_ask",
  monthlyReconciliationSent: "monthly_reconciliation_sent",
  lastComplaintDate: "last_complaint_date",
  lastTransferDate: "last_transfer_date",
  lastTransferReason: "last_transfer_reason",
  dataTier: "data_tier",
  accessScopes: "access_scopes",
  tierConfirmed: "tier_confirmed",
  verificationMethod: "verification_method",
  verifiedBy: "verified_by",
  verifiedAt: "verified_at",
  reviewDueAt: "review_due_at",
  billingEntityId: "billing_entity_id",
  billingMode: "billing_mode",
  metadata: "metadata",
};

/** JSON-serialized fields that need special handling in updateField. */
const JSON_FIELDS = new Set<keyof CustomerProfile>([
  "mainCategories",
  "declinedFields",
  "warnedBillIds",
  "accessScopes",
  "pendingNotifications",
  "metadata",
]);

/** Boolean fields stored as INTEGER 0|1 in SQLite. */
const BOOL_INT_FIELDS = new Set<keyof CustomerProfile>([
  "isBiddingCustomer",
  "optOutProactive",
  "tierConfirmed",
]);

export class CustomerProfileStore {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly statements: ProfileStatements;

  private constructor(db: DatabaseSync, dbPath: string, statements: ProfileStatements) {
    this.db = db;
    this.dbPath = dbPath;
    this.statements = statements;
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  /**
   * Open (or create) a CustomerProfileStore at the given path.
   * Defaults to ~/.openclaw/customers/profiles.sqlite when omitted.
   */
  static open(dbPath?: string): CustomerProfileStore {
    const resolvedPath = dbPath ?? resolveCustomerProfilesSqlitePath(process.env);
    const dir = path.dirname(resolvedPath);

    mkdirSync(dir, { recursive: true, mode: DB_DIR_MODE });
    chmodSync(dir, DB_DIR_MODE);

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(resolvedPath);

    db.prepare(`PRAGMA journal_mode = WAL`).run();
    db.prepare(`PRAGMA synchronous = NORMAL`).run();
    db.prepare(`PRAGMA busy_timeout = 5000`).run();

    ensureSchema(db);
    CustomerProfileStore.setFilePermissions(resolvedPath);

    return new CustomerProfileStore(db, resolvedPath, createStatements(db));
  }

  private static setFilePermissions(dbPath: string): void {
    for (const suffix of DB_SIDECAR_SUFFIXES) {
      const candidate = `${dbPath}${suffix}`;
      if (existsSync(candidate)) {
        chmodSync(candidate, DB_FILE_MODE);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /** Create or fully replace a customer profile. */
  upsert(profile: Partial<CustomerProfile> & { id: string }): void {
    const now = new Date().toISOString();
    const params = profileToBindParams(profile, now);
    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      this.statements.upsert.run(params);
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
    CustomerProfileStore.setFilePermissions(this.dbPath);
  }

  /**
   * Update a single field on an existing profile.
   * JSON array/object fields are serialized automatically.
   */
  updateField(id: string, field: keyof CustomerProfile, value: unknown): void {
    const column = FIELD_TO_COLUMN[field];
    if (!column) {
      throw new Error(`Unknown CustomerProfile field: ${field}`);
    }

    type SqlVal = null | number | bigint | string;
    let storedValue: SqlVal = value as SqlVal;
    if (JSON_FIELDS.has(field)) {
      storedValue = serializeJson(value);
    } else if (BOOL_INT_FIELDS.has(field)) {
      storedValue = boolToInt(value as boolean | null);
    }

    const now = new Date().toISOString();
    // column name is validated against the exhaustive FIELD_TO_COLUMN map above;
    // it is never derived from user input so interpolation is safe here.
    this.db
      .prepare(`UPDATE customer_profiles SET ${column} = ?, updated_at = ? WHERE id = ?`)
      .run(storedValue, now, id);
    CustomerProfileStore.setFilePermissions(this.dbPath);
  }

  /** Append a field name to declinedFields for a profile. Idempotent. */
  addDeclinedField(id: string, field: string): void {
    // Validate the field name is a recognized completeness field
    const validFields = new Set<string>(COMPLETENESS_FIELDS as readonly string[]);
    if (!validFields.has(field)) {
      throw new Error(
        `Invalid declined field: "${field}". Must be one of: ${[...validFields].join(", ")}`,
      );
    }
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`CustomerProfile not found: ${id}`);
    }
    const current = existing.declinedFields ?? [];
    if (current.includes(field)) {
      return;
    }
    this.updateField(id, "declinedFields", [...current, field]);
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  get(id: string): CustomerProfile | null {
    const row = this.statements.selectById.get(id) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  getByChannelPeer(channelType: string, channelPeerId: string): CustomerProfile | null {
    const row = this.statements.selectByChannelPeer.get(channelType, channelPeerId) as
      | ProfileRow
      | undefined;
    return row ? rowToProfile(row) : null;
  }

  getByAgentId(agentId: string): CustomerProfile | null {
    const row = this.statements.selectByAgentId.get(agentId) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  getByKingdeeId(kingdeeId: string): CustomerProfile | null {
    const row = this.statements.selectByKingdeeId.get(kingdeeId) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  list(filter?: { status?: ProfileStatus; hasKingdeeId?: boolean }): CustomerProfile[] {
    const status = filter?.status;
    const hasKingdeeId = filter?.hasKingdeeId;

    let rows: ProfileRow[];
    if (status != null && hasKingdeeId === true) {
      rows = this.statements.selectByStatusWithKingdeeId.all(status) as ProfileRow[];
    } else if (status != null) {
      rows = this.statements.selectByStatus.all(status) as ProfileRow[];
    } else if (hasKingdeeId === true) {
      rows = this.statements.selectWithKingdeeId.all() as ProfileRow[];
    } else {
      rows = this.statements.selectAll.all() as ProfileRow[];
    }

    return rows.map(rowToProfile);
  }

  // -------------------------------------------------------------------------
  // Completeness scoring
  // -------------------------------------------------------------------------

  /**
   * Calculate a 0-1 completeness score for the profile.
   * Declined fields count as complete (customer chose not to share).
   */
  calculateCompleteness(profile: CustomerProfile): number {
    if (COMPLETENESS_FIELDS.length === 0) {
      return 0;
    }
    const declined = new Set(profile.declinedFields ?? []);
    let filled = 0;
    for (const field of COMPLETENESS_FIELDS) {
      const value = profile[field];
      const isDeclined = declined.has(field);
      const isFilled =
        isDeclined ||
        (Array.isArray(value)
          ? value.length > 0
          : value != null && (typeof value !== "string" || value.trim() !== ""));
      if (isFilled) {
        filled++;
      }
    }
    return Math.round((filled / COMPLETENESS_FIELDS.length) * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Delete operations
  // -------------------------------------------------------------------------

  /**
   * Delete a profile by agent_id. Returns true if a row was deleted.
   * Use clearSensitiveFields() instead when PIPL retention applies.
   */
  async delete(agentId: string): Promise<boolean> {
    this.db.prepare("BEGIN IMMEDIATE").run();
    let changes = 0;
    try {
      const result = this.db
        .prepare(`DELETE FROM customer_profiles WHERE agent_id = ?`)
        .run(agentId) as { changes: number };
      changes = result.changes;
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
    CustomerProfileStore.setFilePermissions(this.dbPath);
    return changes > 0;
  }

  /**
   * Nullify all sensitive PII fields for a profile (PIPL compliance).
   * Retains company_name and kingdee_id for business records.
   * Sets profile_status to 'opt_out'.
   */
  async clearSensitiveFields(agentId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      this.db
        .prepare(
          `UPDATE customer_profiles SET
            name                  = NULL,
            job_title             = NULL,
            phone                 = NULL,
            email                 = NULL,
            bank_account          = NULL,
            bank_name             = NULL,
            tax_id                = NULL,
            invoice_address       = NULL,
            invoice_phone         = NULL,
            pending_notifications = NULL,
            metadata              = NULL,
            last_transfer_reason  = NULL,
            next_to_ask           = NULL,
            completeness          = 0,
            profile_status        = 'opt_out',
            opt_out_proactive     = 1,
            updated_at            = ?
          WHERE agent_id = ?`,
        )
        .run(now, agentId);
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
    CustomerProfileStore.setFilePermissions(this.dbPath);
  }

  // -------------------------------------------------------------------------
  // Billing entity operations
  // -------------------------------------------------------------------------

  /** Create or update a billing entity (group company invoicing record). */
  upsertBillingEntity(
    entity: Omit<BillingEntity, "createdAt" | "updatedAt"> &
      Partial<Pick<BillingEntity, "createdAt" | "updatedAt">>,
  ): void {
    const now = new Date().toISOString();
    const params = {
      id: entity.id,
      company_name: entity.companyName,
      tax_id: entity.taxId ?? null,
      bank_name: entity.bankName ?? null,
      bank_account: entity.bankAccount ?? null,
      address: entity.address ?? null,
      phone: entity.phone ?? null,
      kingdee_group_name: entity.kingdeeGroupName ?? null,
      source: entity.source,
      verified_at: entity.verifiedAt ?? null,
      created_at: entity.createdAt ?? now,
      updated_at: now,
    };
    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      this.statements.beUpsert.run(params);
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
    CustomerProfileStore.setFilePermissions(this.dbPath);
  }

  /** Get a billing entity by ID. */
  getBillingEntity(id: string): BillingEntity | null {
    const row = this.statements.beSelectById.get(id) as BillingEntityRow | undefined;
    return row ? rowToBillingEntity(row) : null;
  }

  /** Find a billing entity by Kingdee group_name. */
  getBillingEntityByGroupName(groupName: string): BillingEntity | null {
    const row = this.statements.beSelectByGroupName.get(groupName) as BillingEntityRow | undefined;
    return row ? rowToBillingEntity(row) : null;
  }

  /** Find a billing entity by company name (exact match). */
  getBillingEntityByCompanyName(companyName: string): BillingEntity | null {
    const row = this.statements.beSelectByCompanyName.get(companyName) as
      | BillingEntityRow
      | undefined;
    return row ? rowToBillingEntity(row) : null;
  }

  /** List all billing entities. */
  listBillingEntities(): BillingEntity[] {
    const rows = this.statements.beSelectAll.all() as BillingEntityRow[];
    return rows.map(rowToBillingEntity);
  }

  /** List all customer profiles linked to a billing entity. */
  listByBillingEntityId(billingEntityId: string): CustomerProfile[] {
    const rows = this.statements.selectByBillingEntityId.all(billingEntityId) as ProfileRow[];
    return rows.map(rowToProfile);
  }

  /**
   * Link a customer profile to a billing entity.
   * Sets billing_entity_id and billing_mode='group'.
   */
  linkToBillingEntity(profileId: string, billingEntityId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE customer_profiles SET billing_entity_id = ?, billing_mode = 'group', updated_at = ? WHERE id = ?`,
      )
      .run(billingEntityId, now, profileId);
    CustomerProfileStore.setFilePermissions(this.dbPath);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
