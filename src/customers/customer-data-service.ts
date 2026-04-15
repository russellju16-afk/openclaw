import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveEnterpriseDbPath } from "./enterprise-db.paths.js";

type Nullable<T> = T | null;

type CustomerRow = {
  id: string;
  channel: string;
  channel_user_id: string;
  name: string | null;
  phone: string | null;
  job_title: string | null;
  company_name: string | null;
  company_address: string | null;
  tax_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  invoice_address: string | null;
  invoice_phone: string | null;
  main_categories: string | null;
  monthly_avg_amount: number | null;
  preferred_brands: string | null;
  kingdee_id: string | null;
  kingdee_customer_name: string | null;
  status: string | null;
  consent_given_at: string | null;
  onboarding_sent_at: string | null;
  opt_out_proactive: number | null;
  last_conversation_date: string | null;
  daily_proactive_sent_date: string | null;
  next_to_ask: string | null;
  declined_fields: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  is_deleted: number | null;
  data_tier: string | null;
  tier_confirmed: number | null;
  verification_method: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_due_at: string | null;
};

type PartyNodeRow = {
  id: string;
  root_account_id: string;
  node_type: string;
  name: string;
  display_name: string | null;
  status: string | null;
  parent_id: string | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  is_deleted: number | null;
};

type PartyEdgeRow = {
  id: string;
  from_party_id: string;
  to_party_id: string;
  edge_type: string;
  valid_from: string | null;
  valid_to: string | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  is_deleted: number | null;
};

type PartyExternalRefRow = {
  id: string;
  party_id: string;
  ref_type: string;
  ref_value: string;
  source_system: string | null;
  is_primary: number | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  is_deleted: number | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_type: string | null;
  buyer_name: string;
  buyer_tax_id: string | null;
  invoice_date: string | null;
  amount_incl_tax: number | null;
  amount_excl_tax: number | null;
  tax_amount: number | null;
  status: string | null;
  source_system: string | null;
  source_key: string | null;
  kingdee_bill_no: string | null;
  pdf_path: string | null;
};

type DocumentRow = {
  id: string;
  doc_type: string;
  file_id: string | null;
  title: string;
  counterparty: string | null;
  amount_cents: number | null;
  currency: string | null;
  issue_date: string | null;
  expires_at: string | null;
  risk_level: string | null;
  status: string | null;
  source_system: string | null;
  source_key: string | null;
};

type ContactRow = {
  id: string;
  company_name: string;
  customer_id: string | null;
  contact_name: string;
  job_title: string | null;
  phone: string | null;
  department: string | null;
  location_name: string | null;
  notes: string | null;
};

type LocationRow = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  location_type: string;
  location_name: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  notes: string | null;
};

type InteractionThreadRow = {
  id: string;
  root_account_id: string;
  channel: string | null;
  external_user_id: string | null;
  current_party_id: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ArtifactLinkRow = {
  id: string;
  party_id: string;
  entity_type: string;
  entity_id: string;
  relation_type: string;
  is_primary: number | null;
  scope_mode: string | null;
  metadata_json: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProductRow = {
  id: string;
  full_name: string;
  display_name: string | null;
  category: string;
  spec: string | null;
  unit: string | null;
  avg_price: number | null;
  tax_code: string | null;
  tax_rate: string | null;
  frequency: number | null;
  brand: string | null;
  status: string | null;
  is_deleted: number | null;
};

type ProductMasterActiveRow = {
  material_id: string;
  product_code: string | null;
  name: string;
  category: string | null;
  spec: string | null;
  unit_name: string | null;
  keywords_json: string | null;
  last_sale_date: string | null;
  sales_180d_count: number | null;
  avg_tax_price_180d: number | null;
  active_reason: string | null;
  source_synced_at: string | null;
  updated_at: string | null;
};

type SalesLineDailyRow = {
  material_id: string;
  material_name: string | null;
  material_model: string | null;
  unit_name: string | null;
  bill_date: string;
  qty: number | null;
  amount: number | null;
  tax_price: number | null;
};

export type CustomerPartyResolution =
  | "party_ref"
  | "customer_party_via_kingdee_id"
  | "customer_party_via_company_name"
  | "customer_only"
  | "unresolved";

export interface EnterpriseCustomerRecord {
  id: string;
  channel: string;
  channelUserId: string;
  name: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyAddress: string | null;
  taxId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  invoiceAddress: string | null;
  invoicePhone: string | null;
  mainCategories: string[] | null;
  monthlyAvgAmount: number | null;
  preferredBrands: string[] | null;
  kingdeeId: string | null;
  kingdeeCustomerName: string | null;
  status: string | null;
  lastConversationDate: string | null;
  nextToAsk: string | null;
  declinedFields: string[] | null;
  notes: string | null;
  dataTier: string | null;
  tierConfirmed: boolean;
  verificationMethod: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  reviewDueAt: string | null;
  updatedAt: string | null;
}

export interface PartyNodeRecord {
  id: string;
  rootAccountId: string;
  nodeType: string;
  name: string;
  displayName: string | null;
  status: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PartyExternalRefRecord {
  partyId: string;
  refType: string;
  refValue: string;
  sourceSystem: string | null;
  isPrimary: boolean;
}

export interface ResolvedPartyContext {
  resolution: CustomerPartyResolution;
  matchedBy: string | null;
  rootAccountId: string | null;
  syntheticRootAccountId: string | null;
  currentPartyId: string | null;
  customer: EnterpriseCustomerRecord | null;
  party: PartyNodeRecord | null;
}

export interface DossierArtifactRecord {
  id: string;
  artifactType: string;
  title: string;
  counterparty: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
  sourceSystem: string | null;
  sourceKey: string | null;
  linkMode: "explicit" | "exact_name_fallback";
}

export interface CustomerDossier {
  resolution: CustomerPartyResolution;
  rootAccountId: string | null;
  syntheticRootAccountId: string | null;
  currentPartyId: string | null;
  currentPartyName: string | null;
  currentPartyType: string | null;
  rootParty: PartyNodeRecord | null;
  parties: PartyNodeRecord[];
  edges: Array<{
    fromPartyId: string;
    toPartyId: string;
    edgeType: string;
  }>;
  refsByPartyId: Record<string, PartyExternalRefRecord[]>;
  relatedCustomers: EnterpriseCustomerRecord[];
  invoices: DossierArtifactRecord[];
  documents: DossierArtifactRecord[];
  contacts: Array<{
    id: string;
    companyName: string;
    contactName: string;
    jobTitle: string | null;
    phone: string | null;
    department: string | null;
    locationName: string | null;
    notes: string | null;
  }>;
  locations: Array<{
    id: string;
    customerName: string;
    locationType: string;
    locationName: string | null;
    address: string | null;
    city: string | null;
    district: string | null;
    notes: string | null;
  }>;
  artifactSummary: {
    invoices: number;
    documents: number;
  };
}

export interface CustomerIntentCandidate {
  intentType:
    | "reorder"
    | "invoice_lookup"
    | "invoice_profile_update"
    | "contract_review"
    | "bid_review"
    | "customer_tree_overview"
    | "customer_profile_review";
  score: number;
  reason: string;
  payload: Record<string, unknown>;
}

export interface SafePricingRecord {
  productId: string;
  productName: string;
  displayName: string | null;
  category: string;
  spec: string | null;
  unit: string | null;
  avgPrice: number | null;
  taxCode: string | null;
  taxRate: string | null;
  brand: string | null;
  frequency: number | null;
  priceSource: "product_master_active.avg_tax_price_180d" | "products.avg_price";
}

export interface CustomerDemandSignal {
  materialId: string;
  materialName: string;
  spec: string | null;
  unit: string | null;
  purchaseCount: number;
  lastPurchaseAt: string;
  lastQty: number;
  medianGapDays: number | null;
  gapCv: number | null;
  medianQty: number;
  qtyCv: number | null;
  predictedReorderAt: string | null;
  predictedReorderQty: number;
  dueRatio: number | null;
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  recentAvgTaxPrice: number | null;
  priceBaseline: number | null;
  sourceCustomerIds: string[];
}

type EnterpriseStatements = {
  selectCustomerByChannelPeerExact: StatementSync;
  selectCustomerByChannelPeerInsensitive: StatementSync;
  selectCustomerById: StatementSync;
  selectPartyByRef: StatementSync;
  selectPartyNodeById: StatementSync;
  selectPartyNodesByRoot: StatementSync;
  selectPartyEdgesByRoot: StatementSync;
  selectPartyRefsByPartyId: StatementSync;
  selectLatestThread: StatementSync;
  insertThread: StatementSync;
  updateThread: StatementSync;
  insertEvent: StatementSync;
};

function parseJsonArray(raw: string | null): string[] | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function customerRowToRecord(row: CustomerRow): EnterpriseCustomerRecord {
  return {
    id: row.id,
    channel: row.channel,
    channelUserId: row.channel_user_id,
    name: row.name,
    phone: row.phone,
    jobTitle: row.job_title,
    companyName: row.company_name,
    companyAddress: row.company_address,
    taxId: row.tax_id,
    bankName: row.bank_name,
    bankAccount: row.bank_account,
    invoiceAddress: row.invoice_address,
    invoicePhone: row.invoice_phone,
    mainCategories: parseJsonArray(row.main_categories),
    monthlyAvgAmount: row.monthly_avg_amount,
    preferredBrands: parseJsonArray(row.preferred_brands),
    kingdeeId: row.kingdee_id,
    kingdeeCustomerName: row.kingdee_customer_name,
    status: row.status,
    lastConversationDate: row.last_conversation_date,
    nextToAsk: row.next_to_ask,
    declinedFields: parseJsonArray(row.declined_fields),
    notes: row.notes,
    dataTier: row.data_tier,
    tierConfirmed: row.tier_confirmed === 1,
    verificationMethod: row.verification_method,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    reviewDueAt: row.review_due_at,
    updatedAt: row.updated_at,
  };
}

function partyNodeRowToRecord(row: PartyNodeRow): PartyNodeRecord {
  return {
    id: row.id,
    rootAccountId: row.root_account_id,
    nodeType: row.node_type,
    name: row.name,
    displayName: row.display_name,
    status: row.status,
    parentId: row.parent_id,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function partyExternalRefRowToRecord(row: PartyExternalRefRow): PartyExternalRefRecord {
  return {
    partyId: row.party_id,
    refType: row.ref_type,
    refValue: row.ref_value,
    sourceSystem: row.source_system,
    isPrimary: row.is_primary === 1,
  };
}

function createStatements(db: DatabaseSync): EnterpriseStatements {
  return {
    selectCustomerByChannelPeerExact: db.prepare(
      `SELECT * FROM customers
       WHERE is_deleted = 0 AND channel = ? AND channel_user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    ),
    selectCustomerByChannelPeerInsensitive: db.prepare(
      `SELECT * FROM customers
       WHERE is_deleted = 0 AND channel = ? AND lower(channel_user_id) = lower(?)
       ORDER BY updated_at DESC`,
    ),
    selectCustomerById: db.prepare(
      `SELECT * FROM customers WHERE is_deleted = 0 AND id = ? LIMIT 1`,
    ),
    selectPartyByRef: db.prepare(
      `SELECT p.*
       FROM party_external_refs r
       JOIN party_nodes p ON p.id = r.party_id
       WHERE coalesce(r.is_deleted, 0) = 0
         AND coalesce(p.is_deleted, 0) = 0
         AND r.ref_type = ?
         AND r.ref_value = ?
       ORDER BY coalesce(r.is_primary, 0) DESC, p.updated_at DESC
       LIMIT 1`,
    ),
    selectPartyNodeById: db.prepare(
      `SELECT * FROM party_nodes WHERE coalesce(is_deleted, 0) = 0 AND id = ? LIMIT 1`,
    ),
    selectPartyNodesByRoot: db.prepare(
      `SELECT * FROM party_nodes
       WHERE coalesce(is_deleted, 0) = 0 AND root_account_id = ?
       ORDER BY CASE node_type
         WHEN 'root_account' THEN 0
         WHEN 'legal_entity' THEN 1
         ELSE 2
       END, name`,
    ),
    selectPartyEdgesByRoot: db.prepare(
      `SELECT e.*
       FROM party_edges e
       JOIN party_nodes p ON p.id = e.from_party_id
       WHERE coalesce(e.is_deleted, 0) = 0
         AND coalesce(p.is_deleted, 0) = 0
         AND p.root_account_id = ?
       ORDER BY e.from_party_id, e.to_party_id`,
    ),
    selectPartyRefsByPartyId: db.prepare(
      `SELECT * FROM party_external_refs
       WHERE coalesce(is_deleted, 0) = 0 AND party_id = ?
       ORDER BY ref_type, coalesce(is_primary, 0) DESC, ref_value`,
    ),
    selectLatestThread: db.prepare(
      `SELECT * FROM interaction_threads
       WHERE coalesce(is_deleted, 0) = 0
         AND root_account_id = ?
         AND channel = ?
         AND external_user_id = ?
         AND status = 'active'
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    ),
    insertThread: db.prepare(
      `INSERT INTO interaction_threads (
        id, root_account_id, channel, external_user_id, current_party_id,
        status, created_at, updated_at, created_by, is_deleted
      ) VALUES (
        @id, @root_account_id, @channel, @external_user_id, @current_party_id,
        @status, @created_at, @updated_at, @created_by, 0
      )`,
    ),
    updateThread: db.prepare(
      `UPDATE interaction_threads
       SET current_party_id = @current_party_id,
           updated_at = @updated_at
       WHERE id = @id`,
    ),
    insertEvent: db.prepare(
      `INSERT INTO interaction_events (
        id, thread_id, root_account_id, actor_type, actor_id, event_type,
        content_text, payload_json, happened_at, created_by
      ) VALUES (
        @id, @thread_id, @root_account_id, @actor_type, @actor_id, @event_type,
        @content_text, @payload_json, @happened_at, @created_by
      )`,
    ),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid] ?? null;
}

function populationStdev(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) {
    return null;
  }
  const stdev = populationStdev(values);
  return stdev == null ? null : stdev / mean;
}

function addDays(isoDate: string, days: number): string | null {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) {
    return null;
  }
  return new Date(ts + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createPlaceholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function buildSyntheticRootAccountId(customerId: string): string {
  return `customer:${customerId}`;
}

export class CustomerDataService {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly dbPath: string,
    private readonly statements: EnterpriseStatements,
  ) {}

  static open(dbPath?: string): CustomerDataService {
    const resolvedPath = dbPath ?? resolveEnterpriseDbPath(process.env);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Enterprise database not found at ${resolvedPath}`);
    }

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(resolvedPath);
    db.prepare(`PRAGMA journal_mode = WAL`).run();
    db.prepare(`PRAGMA synchronous = NORMAL`).run();
    db.prepare(`PRAGMA busy_timeout = 5000`).run();
    return new CustomerDataService(db, resolvedPath, createStatements(db));
  }

  static tryOpen(dbPath?: string): CustomerDataService | null {
    const resolvedPath = dbPath ?? resolveEnterpriseDbPath(process.env);
    if (!existsSync(resolvedPath)) {
      return null;
    }
    return CustomerDataService.open(resolvedPath);
  }

  get path(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }

  getCustomerByChannelPeer(
    channel: string,
    channelUserId: string,
  ): EnterpriseCustomerRecord | null {
    const exact = this.statements.selectCustomerByChannelPeerExact.get(channel, channelUserId) as
      | CustomerRow
      | undefined;
    if (exact) {
      return customerRowToRecord(exact);
    }

    const caseInsensitive = this.statements.selectCustomerByChannelPeerInsensitive.all(
      channel,
      channelUserId,
    ) as CustomerRow[];
    return caseInsensitive.length > 0 ? customerRowToRecord(caseInsensitive[0]) : null;
  }

  resolveParty(params: {
    channel?: string;
    channelUserId?: string;
    companyName?: string | null;
    kingdeeId?: string | null;
  }): ResolvedPartyContext {
    const customer =
      params.channel && params.channelUserId
        ? this.getCustomerByChannelPeer(params.channel, params.channelUserId)
        : null;

    const candidateKingdeeId = params.kingdeeId?.trim() || customer?.kingdeeId?.trim() || null;
    const candidateCompanyName =
      params.companyName?.trim() || customer?.companyName?.trim() || null;

    const byKingdee = candidateKingdeeId
      ? (this.statements.selectPartyByRef.get("kingdee_id", candidateKingdeeId) as
          | PartyNodeRow
          | undefined)
      : undefined;
    if (byKingdee) {
      return {
        resolution: customer ? "customer_party_via_kingdee_id" : "party_ref",
        matchedBy: "kingdee_id",
        rootAccountId: byKingdee.root_account_id,
        syntheticRootAccountId: null,
        currentPartyId: byKingdee.id,
        customer,
        party: partyNodeRowToRecord(byKingdee),
      };
    }

    const byCompanyName = candidateCompanyName
      ? (this.statements.selectPartyByRef.get("company_name", candidateCompanyName) as
          | PartyNodeRow
          | undefined)
      : undefined;
    if (byCompanyName) {
      return {
        resolution: customer ? "customer_party_via_company_name" : "party_ref",
        matchedBy: "company_name",
        rootAccountId: byCompanyName.root_account_id,
        syntheticRootAccountId: null,
        currentPartyId: byCompanyName.id,
        customer,
        party: partyNodeRowToRecord(byCompanyName),
      };
    }

    if (customer) {
      return {
        resolution: "customer_only",
        matchedBy: "customer_row",
        rootAccountId: null,
        syntheticRootAccountId: buildSyntheticRootAccountId(customer.id),
        currentPartyId: null,
        customer,
        party: null,
      };
    }

    return {
      resolution: "unresolved",
      matchedBy: null,
      rootAccountId: null,
      syntheticRootAccountId: null,
      currentPartyId: null,
      customer: null,
      party: null,
    };
  }

  private listPartyNodes(rootAccountId: string): PartyNodeRecord[] {
    const rows = this.statements.selectPartyNodesByRoot.all(rootAccountId) as PartyNodeRow[];
    return rows.map(partyNodeRowToRecord);
  }

  private listPartyEdges(rootAccountId: string): Array<{
    fromPartyId: string;
    toPartyId: string;
    edgeType: string;
  }> {
    const rows = this.statements.selectPartyEdgesByRoot.all(rootAccountId) as PartyEdgeRow[];
    return rows.map((row) => ({
      fromPartyId: row.from_party_id,
      toPartyId: row.to_party_id,
      edgeType: row.edge_type,
    }));
  }

  private listRefsByPartyId(partyId: string): PartyExternalRefRecord[] {
    const rows = this.statements.selectPartyRefsByPartyId.all(partyId) as PartyExternalRefRow[];
    return rows.map(partyExternalRefRowToRecord);
  }

  private selectRelatedCustomers(params: {
    partyNames: readonly string[];
    kingdeeIds: readonly string[];
    explicitCustomerIds?: readonly string[];
  }): EnterpriseCustomerRecord[] {
    const conditions: string[] = [`coalesce(is_deleted, 0) = 0`];
    const values: string[] = [];

    const orParts: string[] = [];
    if (params.partyNames.length > 0) {
      orParts.push(`company_name IN (${createPlaceholders(params.partyNames)})`);
      values.push(...params.partyNames);
    }
    if (params.kingdeeIds.length > 0) {
      orParts.push(`kingdee_id IN (${createPlaceholders(params.kingdeeIds)})`);
      values.push(...params.kingdeeIds);
    }
    if (params.explicitCustomerIds && params.explicitCustomerIds.length > 0) {
      orParts.push(`id IN (${createPlaceholders(params.explicitCustomerIds)})`);
      values.push(...params.explicitCustomerIds);
    }

    if (orParts.length === 0) {
      return [];
    }

    conditions.push(`(${orParts.join(" OR ")})`);
    const rows = this.db
      .prepare(
        `SELECT * FROM customers
         WHERE ${conditions.join(" AND ")}
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all(...values) as CustomerRow[];
    return rows.map(customerRowToRecord);
  }

  private selectArtifactLinksForParties(
    partyIds: readonly string[],
    entityType: string,
  ): ArtifactLinkRow[] {
    if (partyIds.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(partyIds);
    return this.db
      .prepare(
        `SELECT *
         FROM artifact_party_links
         WHERE coalesce(is_deleted, 0) = 0
           AND entity_type = ?
           AND party_id IN (${placeholders})
         ORDER BY coalesce(is_primary, 0) DESC, updated_at DESC`,
      )
      .all(entityType, ...partyIds) as ArtifactLinkRow[];
  }

  private selectInvoicesByIds(ids: readonly string[]): InvoiceRow[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(ids);
    return this.db
      .prepare(
        `SELECT *
         FROM invoices
         WHERE coalesce(is_deleted, 0) = 0
           AND id IN (${placeholders})
         ORDER BY invoice_date DESC, updated_at DESC`,
      )
      .all(...ids) as InvoiceRow[];
  }

  private selectInvoicesByBuyerNames(names: readonly string[]): InvoiceRow[] {
    if (names.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(names);
    return this.db
      .prepare(
        `SELECT *
         FROM invoices
         WHERE coalesce(is_deleted, 0) = 0
           AND buyer_name IN (${placeholders})
         ORDER BY invoice_date DESC, updated_at DESC`,
      )
      .all(...names) as InvoiceRow[];
  }

  private selectDocumentsByIds(ids: readonly string[]): DocumentRow[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(ids);
    return this.db
      .prepare(
        `SELECT *
         FROM documents
         WHERE coalesce(is_deleted, 0) = 0
           AND id IN (${placeholders})
         ORDER BY issue_date DESC, updated_at DESC`,
      )
      .all(...ids) as DocumentRow[];
  }

  private selectDocumentsByCounterparty(names: readonly string[]): DocumentRow[] {
    if (names.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(names);
    return this.db
      .prepare(
        `SELECT *
         FROM documents
         WHERE coalesce(is_deleted, 0) = 0
           AND counterparty IN (${placeholders})
         ORDER BY issue_date DESC, updated_at DESC`,
      )
      .all(...names) as DocumentRow[];
  }

  private selectContactsByCustomerIds(customerIds: readonly string[]): ContactRow[] {
    if (customerIds.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(customerIds);
    return this.db
      .prepare(
        `SELECT *
         FROM company_contacts
         WHERE coalesce(is_deleted, 0) = 0
           AND customer_id IN (${placeholders})
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all(...customerIds) as ContactRow[];
  }

  private selectLocationsByCustomerIds(customerIds: readonly string[]): LocationRow[] {
    if (customerIds.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(customerIds);
    return this.db
      .prepare(
        `SELECT *
         FROM customer_locations
         WHERE coalesce(is_deleted, 0) = 0
           AND customer_id IN (${placeholders})
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all(...customerIds) as LocationRow[];
  }

  private resolveScopedKingdeeCustomerIds(params: {
    rootAccountId: string | null;
    currentPartyId: string | null;
    refsByPartyId: Record<string, PartyExternalRefRecord[]>;
    relatedCustomers: readonly EnterpriseCustomerRecord[];
  }): string[] {
    if (params.currentPartyId) {
      const partyRefs = params.refsByPartyId[params.currentPartyId] ?? [];
      const ids = partyRefs
        .filter((ref) => ref.refType === "kingdee_id")
        .map((ref) => ref.refValue)
        .filter(Boolean);
      if (ids.length > 0) {
        return Array.from(new Set(ids));
      }
    }

    if (params.rootAccountId) {
      const ids = Object.values(params.refsByPartyId)
        .flat()
        .filter((ref) => ref.refType === "kingdee_id")
        .map((ref) => ref.refValue)
        .filter(Boolean);
      if (ids.length > 0) {
        return Array.from(new Set(ids));
      }
    }

    return Array.from(
      new Set(
        params.relatedCustomers
          .map((customer) => customer.kingdeeId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }

  private selectSalesLineDailyByCustomerIds(customerIds: readonly string[]): SalesLineDailyRow[] {
    if (customerIds.length === 0) {
      return [];
    }
    const placeholders = createPlaceholders(customerIds);
    return this.db
      .prepare(
        `SELECT
           material_id,
           material_name,
           material_model,
           unit_name,
           bill_date,
           SUM(qty) AS qty,
           SUM(all_amount) AS amount,
           AVG(tax_price) AS tax_price
         FROM sales_outbound_lines
         WHERE coalesce(is_deleted, 0) = 0
           AND customer_id IN (${placeholders})
         GROUP BY material_id, material_name, material_model, unit_name, bill_date
         ORDER BY material_id, bill_date`,
      )
      .all(...customerIds) as SalesLineDailyRow[];
  }

  private selectProductMasterActiveByMaterialIds(
    materialIds: readonly string[],
  ): Map<string, ProductMasterActiveRow> {
    if (materialIds.length === 0) {
      return new Map();
    }
    const placeholders = createPlaceholders(materialIds);
    const rows = this.db
      .prepare(
        `SELECT *
         FROM product_master_active
         WHERE material_id IN (${placeholders})
         ORDER BY material_id`,
      )
      .all(...materialIds) as ProductMasterActiveRow[];
    return new Map(rows.map((row) => [row.material_id, row]));
  }

  getCustomerDossier(params: {
    channel?: string;
    channelUserId?: string;
    rootAccountId?: string;
  }): CustomerDossier {
    const resolved =
      params.rootAccountId != null
        ? {
            resolution: "party_ref" as const,
            matchedBy: "root_account_id",
            rootAccountId: params.rootAccountId,
            syntheticRootAccountId: null,
            currentPartyId: null,
            customer: null,
            party: null,
          }
        : this.resolveParty({
            channel: params.channel,
            channelUserId: params.channelUserId,
          });

    const rootAccountId = resolved.rootAccountId;
    const syntheticRootAccountId = resolved.syntheticRootAccountId;

    if (!rootAccountId && !syntheticRootAccountId) {
      return {
        resolution: resolved.resolution,
        rootAccountId: null,
        syntheticRootAccountId: null,
        currentPartyId: null,
        currentPartyName: null,
        currentPartyType: null,
        rootParty: null,
        parties: [],
        edges: [],
        refsByPartyId: {},
        relatedCustomers: [],
        invoices: [],
        documents: [],
        contacts: [],
        locations: [],
        artifactSummary: {
          invoices: 0,
          documents: 0,
        },
      };
    }

    const parties = rootAccountId ? this.listPartyNodes(rootAccountId) : [];
    const edges = rootAccountId ? this.listPartyEdges(rootAccountId) : [];
    const refsByPartyId: Record<string, PartyExternalRefRecord[]> = {};
    for (const party of parties) {
      refsByPartyId[party.id] = this.listRefsByPartyId(party.id);
    }

    const partyNames =
      parties.length > 0
        ? Array.from(
            new Set(
              parties.flatMap((party) =>
                [party.name, party.displayName].filter((value): value is string => Boolean(value)),
              ),
            ),
          )
        : resolved.customer?.companyName
          ? [resolved.customer.companyName]
          : [];

    const kingdeeIds =
      parties.length > 0
        ? Array.from(
            new Set(
              parties.flatMap((party) =>
                (refsByPartyId[party.id] ?? [])
                  .filter((ref) => ref.refType === "kingdee_id")
                  .map((ref) => ref.refValue),
              ),
            ),
          )
        : resolved.customer?.kingdeeId
          ? [resolved.customer.kingdeeId]
          : [];

    const relatedCustomers = this.selectRelatedCustomers({
      partyNames,
      kingdeeIds,
      explicitCustomerIds: resolved.customer ? [resolved.customer.id] : undefined,
    });

    const customerIds = relatedCustomers.map((customer) => customer.id);
    const currentPartyName = resolved.party?.displayName ?? resolved.party?.name ?? null;
    const currentPartyType = resolved.party?.nodeType ?? null;
    const rootParty =
      rootAccountId && parties.length > 0
        ? (parties.find(
            (party) => party.id === rootAccountId || party.nodeType === "root_account",
          ) ?? null)
        : null;

    const partyIds = parties.map((party) => party.id);
    const explicitInvoiceLinks = this.selectArtifactLinksForParties(partyIds, "invoice");
    const explicitInvoiceIds = Array.from(
      new Set(explicitInvoiceLinks.map((link) => link.entity_id)),
    );
    const explicitInvoices = this.selectInvoicesByIds(explicitInvoiceIds);
    const fallbackInvoices = this.selectInvoicesByBuyerNames(partyNames);
    const invoices = dedupeById(
      [
        ...explicitInvoices.map((invoice) => ({
          id: invoice.id,
          artifactType: "invoice",
          title: invoice.invoice_number,
          counterparty: invoice.buyer_name,
          status: invoice.status,
          date: invoice.invoice_date,
          amount: invoice.amount_incl_tax,
          sourceSystem: invoice.source_system,
          sourceKey: invoice.source_key,
          linkMode: "explicit" as const,
        })),
        ...fallbackInvoices.map((invoice) => ({
          id: invoice.id,
          artifactType: "invoice",
          title: invoice.invoice_number,
          counterparty: invoice.buyer_name,
          status: invoice.status,
          date: invoice.invoice_date,
          amount: invoice.amount_incl_tax,
          sourceSystem: invoice.source_system,
          sourceKey: invoice.source_key,
          linkMode: "exact_name_fallback" as const,
        })),
      ].toSorted((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? ""))),
    );

    const explicitDocumentLinks = this.selectArtifactLinksForParties(partyIds, "document");
    const explicitDocumentIds = Array.from(
      new Set(explicitDocumentLinks.map((link) => link.entity_id)),
    );
    const explicitDocuments = this.selectDocumentsByIds(explicitDocumentIds);
    const fallbackDocuments = this.selectDocumentsByCounterparty(partyNames);
    const documents = dedupeById(
      [
        ...explicitDocuments.map((document) => ({
          id: document.id,
          artifactType: document.doc_type,
          title: document.title,
          counterparty: document.counterparty,
          status: document.status,
          date: document.issue_date,
          amount: document.amount_cents,
          sourceSystem: document.source_system,
          sourceKey: document.source_key,
          linkMode: "explicit" as const,
        })),
        ...fallbackDocuments.map((document) => ({
          id: document.id,
          artifactType: document.doc_type,
          title: document.title,
          counterparty: document.counterparty,
          status: document.status,
          date: document.issue_date,
          amount: document.amount_cents,
          sourceSystem: document.source_system,
          sourceKey: document.source_key,
          linkMode: "exact_name_fallback" as const,
        })),
      ].toSorted((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? ""))),
    );

    const contacts = this.selectContactsByCustomerIds(customerIds).map((row) => ({
      id: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      jobTitle: row.job_title,
      phone: row.phone,
      department: row.department,
      locationName: row.location_name,
      notes: row.notes,
    }));
    const locations = this.selectLocationsByCustomerIds(customerIds).map((row) => ({
      id: row.id,
      customerName: row.customer_name,
      locationType: row.location_type,
      locationName: row.location_name,
      address: row.address,
      city: row.city,
      district: row.district,
      notes: row.notes,
    }));

    return {
      resolution: resolved.resolution,
      rootAccountId,
      syntheticRootAccountId,
      currentPartyId: resolved.currentPartyId,
      currentPartyName,
      currentPartyType,
      rootParty,
      parties,
      edges,
      refsByPartyId,
      relatedCustomers,
      invoices,
      documents,
      contacts,
      locations,
      artifactSummary: {
        invoices: invoices.length,
        documents: documents.length,
      },
    };
  }

  listIntentCandidates(params: {
    channel?: string;
    channelUserId?: string;
    rootAccountId?: string;
  }): CustomerIntentCandidate[] {
    const dossier = this.getCustomerDossier(params);
    const candidates: CustomerIntentCandidate[] = [];
    const demandSignals = this.listDemandSignals(params);

    const dueSignals = demandSignals
      .filter((signal) => signal.confidence >= 0.55 && (signal.dueRatio ?? 0) >= 0.8)
      .slice(0, 3);
    if (dueSignals.length > 0) {
      const strongest = dueSignals[0];
      candidates.push({
        intentType: "reorder",
        score: Math.min(0.88, strongest.confidence + 0.08),
        reason:
          dueSignals.length === 1
            ? `${strongest.materialName} 已接近补货窗口，预计补货日 ${strongest.predictedReorderAt ?? "待确认"}`
            : `有 ${dueSignals.length} 个商品接近补货窗口，优先检查补货需求`,
        payload: {
          signals: dueSignals.map((signal) => ({
            material_id: signal.materialId,
            material_name: signal.materialName,
            predicted_reorder_at: signal.predictedReorderAt,
            predicted_reorder_qty: signal.predictedReorderQty,
            confidence: signal.confidence,
          })),
        },
      });
    }

    if (dossier.invoices.length > 0) {
      const latestInvoice = dossier.invoices[0];
      candidates.push({
        intentType: "invoice_lookup",
        score: latestInvoice.date ? 0.82 : 0.7,
        reason:
          latestInvoice.date != null
            ? `已归属 ${dossier.invoices.length} 张发票，最近一张日期为 ${latestInvoice.date}`
            : `已归属 ${dossier.invoices.length} 张发票，可优先展示发票与开票相关信息`,
        payload: {
          invoice_count: dossier.invoices.length,
          latest_invoice_id: latestInvoice.id,
          latest_invoice_number: latestInvoice.title,
          root_account_id: dossier.rootAccountId ?? dossier.syntheticRootAccountId,
        },
      });
    }

    const primaryCustomer = dossier.relatedCustomers[0] ?? null;
    const missingInvoiceFields = primaryCustomer
      ? [
          ...(!primaryCustomer.companyName ? ["company_name"] : []),
          ...(!primaryCustomer.taxId ? ["tax_id"] : []),
          ...(!primaryCustomer.bankName ? ["bank_name"] : []),
          ...(!primaryCustomer.bankAccount ? ["bank_account"] : []),
          ...(!primaryCustomer.invoiceAddress ? ["invoice_address"] : []),
          ...(!primaryCustomer.invoicePhone ? ["invoice_phone"] : []),
        ]
      : [];
    if (missingInvoiceFields.length > 0) {
      candidates.push({
        intentType: "invoice_profile_update",
        score: 0.61,
        reason: `客户开票信息缺少 ${missingInvoiceFields.join(", ")}`,
        payload: {
          missing_fields: missingInvoiceFields,
          customer_id: primaryCustomer?.id ?? null,
        },
      });
    }

    const contractDocs = dossier.documents.filter(
      (document) => document.artifactType === "contract",
    );
    if (contractDocs.length > 0) {
      candidates.push({
        intentType: "contract_review",
        score: 0.66,
        reason: `客户资料中有 ${contractDocs.length} 份合同，可优先展示合同与履约信息`,
        payload: {
          document_ids: contractDocs.slice(0, 5).map((document) => document.id),
        },
      });
    }

    const bidDocs = dossier.documents.filter((document) => document.artifactType === "bid");
    if (bidDocs.length > 0) {
      candidates.push({
        intentType: "bid_review",
        score: 0.58,
        reason: `客户资料中有 ${bidDocs.length} 份招投标文件，可优先展示中标与资质材料`,
        payload: {
          document_ids: bidDocs.slice(0, 5).map((document) => document.id),
        },
      });
    }

    if (dossier.parties.length > 1) {
      candidates.push({
        intentType: "customer_tree_overview",
        score: 0.44,
        reason: `该客户已归属到 ${dossier.parties.length} 个节点，适合优先展示客户树和归属关系`,
        payload: {
          party_count: dossier.parties.length,
          root_account_id: dossier.rootAccountId,
        },
      });
    }

    if (primaryCustomer) {
      candidates.push({
        intentType: "customer_profile_review",
        score: 0.32,
        reason: "可先展示客户主档、联系人与地点信息作为会话入口",
        payload: {
          customer_id: primaryCustomer.id,
          company_name: primaryCustomer.companyName,
        },
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score);
  }

  listDemandSignals(params: {
    channel?: string;
    channelUserId?: string;
    rootAccountId?: string;
    limit?: number;
  }): CustomerDemandSignal[] {
    const dossier =
      params.rootAccountId != null
        ? this.getCustomerDossier({
            rootAccountId: params.rootAccountId,
          })
        : this.getCustomerDossier({
            channel: params.channel,
            channelUserId: params.channelUserId,
          });

    const scopedCustomerIds = this.resolveScopedKingdeeCustomerIds({
      rootAccountId: dossier.rootAccountId,
      currentPartyId: dossier.currentPartyId,
      refsByPartyId: dossier.refsByPartyId,
      relatedCustomers: dossier.relatedCustomers,
    });
    const dailyRows = this.selectSalesLineDailyByCustomerIds(scopedCustomerIds);
    const rowsByMaterial = new Map<string, SalesLineDailyRow[]>();
    for (const row of dailyRows) {
      const list = rowsByMaterial.get(row.material_id) ?? [];
      list.push(row);
      rowsByMaterial.set(row.material_id, list);
    }

    const productMaster = this.selectProductMasterActiveByMaterialIds([...rowsByMaterial.keys()]);
    const today = new Date().toISOString().slice(0, 10);
    const signals: CustomerDemandSignal[] = [];

    for (const [materialId, rows] of rowsByMaterial) {
      const sortedRows = [...rows].toSorted((left, right) =>
        left.bill_date.localeCompare(right.bill_date),
      );
      if (sortedRows.length < 3) {
        continue;
      }

      const qtys = sortedRows
        .map((row) => row.qty ?? 0)
        .filter((qty) => Number.isFinite(qty) && qty > 0);
      if (qtys.length < 3) {
        continue;
      }

      const dates = sortedRows.map((row) => row.bill_date);
      const gaps: number[] = [];
      for (let index = 1; index < dates.length; index++) {
        const current = Date.parse(dates[index] ?? "");
        const previous = Date.parse(dates[index - 1] ?? "");
        if (Number.isFinite(current) && Number.isFinite(previous)) {
          gaps.push(Math.round((current - previous) / (24 * 60 * 60 * 1000)));
        }
      }

      const medianGapDays = median(gaps);
      const gapCv = coefficientOfVariation(gaps);
      const medianQty = median(qtys);
      const qtyCv = coefficientOfVariation(qtys);
      const lastRow = sortedRows[sortedRows.length - 1];
      const lastPurchaseAt = lastRow?.bill_date ?? "";
      const lastQty = lastRow?.qty ?? 0;
      const predictedReorderAt =
        medianGapDays != null && lastPurchaseAt ? addDays(lastPurchaseAt, medianGapDays) : null;
      const predictedReorderQty = medianQty ?? lastQty;

      let confidence = 0.15;
      if (sortedRows.length >= 6) {
        confidence += 0.25;
      } else if (sortedRows.length >= 4) {
        confidence += 0.18;
      }
      if (qtyCv != null) {
        if (qtyCv <= 0.35) {
          confidence += 0.22;
        } else if (qtyCv <= 0.5) {
          confidence += 0.14;
        }
      }
      if (medianGapDays != null) {
        if (medianGapDays <= 14) {
          confidence += 0.2;
        } else if (medianGapDays <= 21) {
          confidence += 0.14;
        } else if (medianGapDays <= 30) {
          confidence += 0.08;
        }
      }
      if (gapCv != null) {
        if (gapCv <= 0.6) {
          confidence += 0.14;
        } else if (gapCv <= 0.8) {
          confidence += 0.08;
        }
      }

      let dueRatio: number | null = null;
      if (predictedReorderAt != null && medianGapDays != null && medianGapDays > 0) {
        const daysSinceLast = Math.round(
          (Date.parse(today) - Date.parse(lastPurchaseAt)) / (24 * 60 * 60 * 1000),
        );
        dueRatio = Number((daysSinceLast / medianGapDays).toFixed(4));
        if (dueRatio >= 0.8) {
          confidence += 0.08;
        }
      }

      const priceSamples = sortedRows
        .slice(-5)
        .map((row) => row.tax_price ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      const recentAvgTaxPrice =
        priceSamples.length > 0
          ? priceSamples.reduce((sum, value) => sum + value, 0) / priceSamples.length
          : null;

      const priceBaseline = productMaster.get(materialId)?.avg_tax_price_180d ?? null;
      const cappedConfidence = Math.min(0.95, Number(confidence.toFixed(4)));
      const confidenceBand: CustomerDemandSignal["confidenceBand"] =
        cappedConfidence >= 0.75 ? "high" : cappedConfidence >= 0.55 ? "medium" : "low";

      signals.push({
        materialId,
        materialName: productMaster.get(materialId)?.name ?? lastRow?.material_name ?? materialId,
        spec: productMaster.get(materialId)?.spec ?? lastRow?.material_model ?? null,
        unit: productMaster.get(materialId)?.unit_name ?? lastRow?.unit_name ?? null,
        purchaseCount: sortedRows.length,
        lastPurchaseAt,
        lastQty,
        medianGapDays,
        gapCv,
        medianQty: predictedReorderQty,
        qtyCv,
        predictedReorderAt,
        predictedReorderQty,
        dueRatio,
        confidence: cappedConfidence,
        confidenceBand,
        recentAvgTaxPrice,
        priceBaseline,
        sourceCustomerIds: scopedCustomerIds,
      });
    }

    return signals
      .toSorted((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return right.lastPurchaseAt.localeCompare(left.lastPurchaseAt);
      })
      .slice(0, Math.max(1, Math.min(params.limit ?? 10, 20)));
  }

  getCustomerSafePricing(params: {
    channel?: string;
    channelUserId?: string;
    rootAccountId?: string;
    productId?: string | null;
    query?: string | null;
    limit?: number;
  }): {
    resolution: CustomerPartyResolution | null;
    rootAccountId: string | null;
    syntheticRootAccountId: string | null;
    currentPartyId: string | null;
    currentPartyName: string | null;
    pricingScope: "public_baseline";
    products: SafePricingRecord[];
  } {
    const dossier =
      params.rootAccountId != null
        ? this.getCustomerDossier({
            rootAccountId: params.rootAccountId,
          })
        : this.getCustomerDossier({
            channel: params.channel,
            channelUserId: params.channelUserId,
          });

    const limit = Math.max(1, Math.min(params.limit ?? 10, 20));
    let productRows: ProductRow[] = [];
    let masterRows: ProductMasterActiveRow[] = [];

    if (params.productId?.trim()) {
      masterRows = this.db
        .prepare(
          `SELECT *
           FROM product_master_active
           WHERE material_id = ?
           LIMIT ?`,
        )
        .all(params.productId.trim(), limit) as ProductMasterActiveRow[];
      if (masterRows.length === 0) {
        productRows = this.db
          .prepare(
            `SELECT *
           FROM products
           WHERE coalesce(is_deleted, 0) = 0
             AND coalesce(status, 'active') = 'active'
             AND id = ?
           LIMIT ?`,
          )
          .all(params.productId.trim(), limit) as ProductRow[];
      }
    } else if (params.query?.trim()) {
      const q = `%${params.query.trim()}%`;
      masterRows = this.db
        .prepare(
          `SELECT *
           FROM product_master_active
           WHERE
             name LIKE ?
             OR coalesce(category, '') LIKE ?
             OR coalesce(spec, '') LIKE ?
             OR coalesce(product_code, '') LIKE ?
           ORDER BY coalesce(sales_180d_count, 0) DESC, coalesce(avg_tax_price_180d, 0) DESC, material_id
           LIMIT ?`,
        )
        .all(q, q, q, q, limit) as ProductMasterActiveRow[];
      if (masterRows.length === 0) {
        productRows = this.db
          .prepare(
            `SELECT *
           FROM products
           WHERE coalesce(is_deleted, 0) = 0
             AND coalesce(status, 'active') = 'active'
             AND (
               full_name LIKE ?
               OR coalesce(display_name, '') LIKE ?
               OR category LIKE ?
               OR coalesce(brand, '') LIKE ?
               OR coalesce(spec, '') LIKE ?
             )
           ORDER BY coalesce(frequency, 0) DESC, coalesce(avg_price, 0) DESC, id
           LIMIT ?`,
          )
          .all(q, q, q, q, q, limit) as ProductRow[];
      }
    } else {
      masterRows = this.db
        .prepare(
          `SELECT *
           FROM product_master_active
           ORDER BY coalesce(sales_180d_count, 0) DESC, coalesce(avg_tax_price_180d, 0) DESC, material_id
           LIMIT ?`,
        )
        .all(limit) as ProductMasterActiveRow[];
      if (masterRows.length === 0) {
        productRows = this.db
          .prepare(
            `SELECT *
           FROM products
           WHERE coalesce(is_deleted, 0) = 0
             AND coalesce(status, 'active') = 'active'
           ORDER BY coalesce(frequency, 0) DESC, coalesce(avg_price, 0) DESC, id
           LIMIT ?`,
          )
          .all(limit) as ProductRow[];
      }
    }

    const products: SafePricingRecord[] =
      masterRows.length > 0
        ? masterRows.map((row) => ({
            productId: row.material_id,
            productName: row.name,
            displayName: row.name,
            category: row.category ?? "",
            spec: row.spec,
            unit: row.unit_name,
            avgPrice: row.avg_tax_price_180d,
            taxCode: null,
            taxRate: null,
            brand: null,
            frequency: row.sales_180d_count,
            priceSource: "product_master_active.avg_tax_price_180d",
          }))
        : productRows.map((row) => ({
            productId: row.id,
            productName: row.full_name,
            displayName: row.display_name,
            category: row.category,
            spec: row.spec,
            unit: row.unit,
            avgPrice: row.avg_price,
            taxCode: row.tax_code,
            taxRate: row.tax_rate,
            brand: row.brand,
            frequency: row.frequency,
            priceSource: "products.avg_price",
          }));

    return {
      resolution: dossier.resolution === "unresolved" ? null : dossier.resolution,
      rootAccountId: dossier.rootAccountId,
      syntheticRootAccountId: dossier.syntheticRootAccountId,
      currentPartyId: dossier.currentPartyId,
      currentPartyName: dossier.currentPartyName,
      pricingScope: "public_baseline",
      products,
    };
  }

  recordInteraction(params: {
    channel: string;
    channelUserId: string;
    eventType: string;
    actorType?: string;
    actorId?: string | null;
    contentText?: string | null;
    payloadJson?: string | null;
    createdBy?: string | null;
  }): {
    threadId: string;
    eventId: string;
    rootAccountId: string;
    currentPartyId: string | null;
    resolution: CustomerPartyResolution;
  } {
    const resolved = this.resolveParty({
      channel: params.channel,
      channelUserId: params.channelUserId,
    });
    const rootAccountId =
      resolved.rootAccountId ??
      resolved.syntheticRootAccountId ??
      buildSyntheticRootAccountId("unknown");

    const now = new Date().toISOString();
    const threadRow = this.statements.selectLatestThread.get(
      rootAccountId,
      params.channel,
      params.channelUserId,
    ) as InteractionThreadRow | undefined;
    const threadId = threadRow?.id ?? `ith-${randomUUID()}`;
    const currentPartyId = resolved.currentPartyId ?? null;

    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      if (!threadRow) {
        this.statements.insertThread.run({
          id: threadId,
          root_account_id: rootAccountId,
          channel: params.channel,
          external_user_id: params.channelUserId,
          current_party_id: currentPartyId,
          status: "active",
          created_at: now,
          updated_at: now,
          created_by: params.createdBy ?? null,
        });
      } else {
        this.statements.updateThread.run({
          id: threadId,
          current_party_id: currentPartyId,
          updated_at: now,
        });
      }

      const eventId = `iev-${randomUUID()}`;
      this.statements.insertEvent.run({
        id: eventId,
        thread_id: threadId,
        root_account_id: rootAccountId,
        actor_type: params.actorType ?? "customer",
        actor_id: params.actorId ?? params.channelUserId,
        event_type: params.eventType,
        content_text: params.contentText ?? null,
        payload_json: params.payloadJson ?? null,
        happened_at: now,
        created_by: params.createdBy ?? null,
      });
      this.db.prepare("COMMIT").run();
      return {
        threadId,
        eventId,
        rootAccountId,
        currentPartyId,
        resolution: resolved.resolution,
      };
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
  }

  upsertCustomerMirror(profile: {
    channel: string;
    channelUserId: string;
    name?: Nullable<string>;
    phone?: Nullable<string>;
    jobTitle?: Nullable<string>;
    companyName?: Nullable<string>;
    companyAddress?: Nullable<string>;
    taxId?: Nullable<string>;
    bankName?: Nullable<string>;
    bankAccount?: Nullable<string>;
    invoiceAddress?: Nullable<string>;
    invoicePhone?: Nullable<string>;
    mainCategories?: Nullable<string[]>;
    monthlyAvgAmount?: Nullable<number>;
    preferredBrands?: Nullable<string[]>;
    kingdeeId?: Nullable<string>;
    kingdeeCustomerName?: Nullable<string>;
    status?: Nullable<string>;
    consentGivenAt?: Nullable<string>;
    onboardingSentAt?: Nullable<string>;
    optOutProactive?: Nullable<boolean>;
    lastConversationDate?: Nullable<string>;
    dailyProactiveSentDate?: Nullable<string>;
    nextToAsk?: Nullable<string>;
    declinedFields?: Nullable<string[]>;
    notes?: Nullable<string>;
    dataTier?: Nullable<string>;
    tierConfirmed?: Nullable<boolean>;
    verificationMethod?: Nullable<string>;
    verifiedBy?: Nullable<string>;
    verifiedAt?: Nullable<string>;
    reviewDueAt?: Nullable<string>;
    createdBy?: Nullable<string>;
  }): EnterpriseCustomerRecord {
    const now = new Date().toISOString();
    const existing = this.getCustomerByChannelPeer(profile.channel, profile.channelUserId);
    const id = existing?.id ?? `cust-${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const merged = {
      id,
      channel: profile.channel,
      channel_user_id: profile.channelUserId,
      name: profile.name ?? existing?.name ?? null,
      phone: profile.phone ?? existing?.phone ?? null,
      job_title: profile.jobTitle ?? existing?.jobTitle ?? null,
      company_name: profile.companyName ?? existing?.companyName ?? null,
      company_address: profile.companyAddress ?? existing?.companyAddress ?? null,
      tax_id: profile.taxId ?? existing?.taxId ?? null,
      bank_name: profile.bankName ?? existing?.bankName ?? null,
      bank_account: profile.bankAccount ?? existing?.bankAccount ?? null,
      invoice_address: profile.invoiceAddress ?? existing?.invoiceAddress ?? null,
      invoice_phone: profile.invoicePhone ?? existing?.invoicePhone ?? null,
      main_categories: profile.mainCategories
        ? JSON.stringify(profile.mainCategories)
        : existing?.mainCategories
          ? JSON.stringify(existing.mainCategories)
          : null,
      monthly_avg_amount: profile.monthlyAvgAmount ?? existing?.monthlyAvgAmount ?? null,
      preferred_brands: profile.preferredBrands
        ? JSON.stringify(profile.preferredBrands)
        : existing?.preferredBrands
          ? JSON.stringify(existing.preferredBrands)
          : null,
      kingdee_id: profile.kingdeeId ?? existing?.kingdeeId ?? null,
      kingdee_customer_name: profile.kingdeeCustomerName ?? existing?.kingdeeCustomerName ?? null,
      status: profile.status ?? existing?.status ?? "pending",
      consent_given_at: profile.consentGivenAt ?? null,
      onboarding_sent_at: profile.onboardingSentAt ?? null,
      opt_out_proactive:
        profile.optOutProactive == null
          ? existing?.status === "opt_out"
            ? 1
            : 0
          : profile.optOutProactive
            ? 1
            : 0,
      last_conversation_date:
        profile.lastConversationDate ?? existing?.lastConversationDate ?? null,
      daily_proactive_sent_date: profile.dailyProactiveSentDate ?? null,
      next_to_ask: profile.nextToAsk ?? existing?.nextToAsk ?? null,
      declined_fields: profile.declinedFields
        ? JSON.stringify(profile.declinedFields)
        : existing?.declinedFields
          ? JSON.stringify(existing.declinedFields)
          : null,
      notes: profile.notes ?? existing?.notes ?? null,
      created_at: existing?.updatedAt ?? now,
      updated_at: now,
      created_by: profile.createdBy ?? null,
      is_deleted: 0,
      data_tier: profile.dataTier ?? existing?.dataTier ?? "unknown",
      tier_confirmed:
        profile.tierConfirmed == null
          ? existing?.tierConfirmed
            ? 1
            : 0
          : profile.tierConfirmed
            ? 1
            : 0,
      verification_method: profile.verificationMethod ?? existing?.verificationMethod ?? null,
      verified_by: profile.verifiedBy ?? existing?.verifiedBy ?? null,
      verified_at: profile.verifiedAt ?? existing?.verifiedAt ?? null,
      review_due_at: profile.reviewDueAt ?? existing?.reviewDueAt ?? null,
    };

    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      this.db
        .prepare(
          `INSERT INTO customers (
            id, channel, channel_user_id, name, phone, job_title, company_name, company_address,
            tax_id, bank_name, bank_account, invoice_address, invoice_phone,
            main_categories, monthly_avg_amount, preferred_brands,
            kingdee_id, kingdee_customer_name, status, consent_given_at, onboarding_sent_at,
            opt_out_proactive, last_conversation_date, daily_proactive_sent_date, next_to_ask,
            declined_fields, notes, created_at, updated_at, created_by, is_deleted,
            data_tier, tier_confirmed, verification_method, verified_by, verified_at, review_due_at
          ) VALUES (
            @id, @channel, @channel_user_id, @name, @phone, @job_title, @company_name, @company_address,
            @tax_id, @bank_name, @bank_account, @invoice_address, @invoice_phone,
            @main_categories, @monthly_avg_amount, @preferred_brands,
            @kingdee_id, @kingdee_customer_name, @status, @consent_given_at, @onboarding_sent_at,
            @opt_out_proactive, @last_conversation_date, @daily_proactive_sent_date, @next_to_ask,
            @declined_fields, @notes, @created_at, @updated_at, @created_by, @is_deleted,
            @data_tier, @tier_confirmed, @verification_method, @verified_by, @verified_at, @review_due_at
          )
          ON CONFLICT(id) DO UPDATE SET
            channel = excluded.channel,
            channel_user_id = excluded.channel_user_id,
            name = excluded.name,
            phone = excluded.phone,
            job_title = excluded.job_title,
            company_name = excluded.company_name,
            company_address = excluded.company_address,
            tax_id = excluded.tax_id,
            bank_name = excluded.bank_name,
            bank_account = excluded.bank_account,
            invoice_address = excluded.invoice_address,
            invoice_phone = excluded.invoice_phone,
            main_categories = excluded.main_categories,
            monthly_avg_amount = excluded.monthly_avg_amount,
            preferred_brands = excluded.preferred_brands,
            kingdee_id = excluded.kingdee_id,
            kingdee_customer_name = excluded.kingdee_customer_name,
            status = excluded.status,
            consent_given_at = excluded.consent_given_at,
            onboarding_sent_at = excluded.onboarding_sent_at,
            opt_out_proactive = excluded.opt_out_proactive,
            last_conversation_date = excluded.last_conversation_date,
            daily_proactive_sent_date = excluded.daily_proactive_sent_date,
            next_to_ask = excluded.next_to_ask,
            declined_fields = excluded.declined_fields,
            notes = excluded.notes,
            updated_at = excluded.updated_at,
            created_by = excluded.created_by,
            is_deleted = excluded.is_deleted,
            data_tier = excluded.data_tier,
            tier_confirmed = excluded.tier_confirmed,
            verification_method = excluded.verification_method,
            verified_by = excluded.verified_by,
            verified_at = excluded.verified_at,
            review_due_at = excluded.review_due_at`,
        )
        .run(merged);
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }

    const row = this.statements.selectCustomerById.get(id) as CustomerRow | undefined;
    if (!row) {
      throw new Error(`Failed to read mirrored enterprise customer ${id}`);
    }
    return customerRowToRecord(row);
  }
}
