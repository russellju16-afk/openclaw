// ---------------------------------------------------------------------------
// Customer data access authorization.
//
// Centralizes all tier → scope → capability decisions so that MCP tools
// and Kingdee CLI adapters never need to implement their own auth logic.
// All functions are pure — no side effects, no mutations.
// ---------------------------------------------------------------------------

// Re-use types from profile-store (will be exported there by the schema agent)
// For now, define locally to avoid circular deps — align after schema lands.

export type DataTier = "boss" | "manager" | "staff" | "unknown";

export type DataAccessScope =
  | "public" // 产品目录、库存、公开价格
  | "self_orders" // 自己经手的订单和物流
  | "company_ops" // 公司全部订单、采购历史
  | "company_finance"; // 应收账款、信用额度、对账单、发票

// ---------------------------------------------------------------------------
// Tier → default scopes mapping
// ---------------------------------------------------------------------------

/** Default access scopes granted to each tier when no explicit scopes are set. */
const DEFAULT_TIER_SCOPES: Record<DataTier, readonly DataAccessScope[]> = {
  boss: ["public", "self_orders", "company_ops", "company_finance"],
  manager: ["public", "self_orders", "company_ops"],
  staff: ["public", "self_orders"],
  unknown: ["public"],
};

// ---------------------------------------------------------------------------
// Kingdee capability definitions
// ---------------------------------------------------------------------------

/** Named Kingdee CLI capabilities that can be gated by scope. */
export type KingdeeCapability =
  | "master_query" // 客户主档查询
  | "sales_query" // 销售订单查询
  | "arap_debt" // 应收账款查询
  | "arap_statement" // 对账单
  | "invoice_info" // 开票信息
  | "inventory_query" // 库存查询
  | "price_query"; // 价格查询

/** Which scopes grant which Kingdee capabilities. */
const SCOPE_CAPABILITIES: Record<DataAccessScope, readonly KingdeeCapability[]> = {
  public: ["master_query", "inventory_query", "price_query"],
  self_orders: ["sales_query"],
  company_ops: ["sales_query", "master_query"],
  company_finance: ["arap_debt", "arap_statement", "invoice_info"],
};

// ---------------------------------------------------------------------------
// Kingdee field whitelists per scope
// ---------------------------------------------------------------------------

/** Fields allowed in sales query responses, by scope level. */
const SALES_FIELDS_BY_SCOPE: Record<DataAccessScope, readonly string[]> = {
  public: [
    "product_name",
    "item_name",
    "material_name",
    "specification",
    "spec",
    "model",
    "unit",
    "uom",
  ],
  self_orders: [
    "date",
    "bill_date",
    "document_date",
    "product_name",
    "item_name",
    "material_name",
    "specification",
    "spec",
    "model",
    "quantity",
    "qty",
    "unit_price",
    "sale_price",
    "price",
    "amount",
    "total_amount",
    "line_amount",
    "unit",
    "uom",
    "bill_no",
    "document_no",
    "order_no",
    "warehouse",
    "warehouse_name",
    "remark",
    "note",
  ],
  company_ops: [
    "date",
    "bill_date",
    "document_date",
    "product_name",
    "item_name",
    "material_name",
    "specification",
    "spec",
    "model",
    "quantity",
    "qty",
    "unit_price",
    "sale_price",
    "price",
    "amount",
    "total_amount",
    "line_amount",
    "unit",
    "uom",
    "bill_no",
    "document_no",
    "order_no",
    "customer_name",
    "customer_id",
    "warehouse",
    "warehouse_name",
    "remark",
    "note",
  ],
  company_finance: [
    // Finance scope inherits all company_ops fields plus AR-specific ones.
    // Handled by merging in resolveAllowedSalesFields().
  ],
};

/** Fields allowed in AR (accounts receivable) responses. Only company_finance scope. */
const AR_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "customer_name",
  "customer_id",
  "bill_no",
  "document_no",
  "date",
  "bill_date",
  "due_date",
  "amount",
  "total_amount",
  "balance",
  "currency",
  "remark",
  "note",
  "aging",
  "aging_bucket",
]);

// ---------------------------------------------------------------------------
// Authorization result
// ---------------------------------------------------------------------------

export interface AccessAuthorization {
  /** The resolved tier (from profile or default). */
  tier: DataTier;
  /** Whether the tier has been verified by internal staff. */
  confirmed: boolean;
  /** Effective scopes (explicit or derived from tier). */
  scopes: readonly DataAccessScope[];
  /** Kingdee capabilities this contact is allowed to use. */
  allowedCapabilities: ReadonlySet<KingdeeCapability>;
  /** Whether AR/debt queries are permitted. */
  canQueryAR: boolean;
  /** Whether full company-wide order history is permitted. */
  canQueryAllOrders: boolean;
  /** Whether invoice info can be displayed. */
  canViewInvoiceInfo: boolean;
}

// ---------------------------------------------------------------------------
// Core authorization function
// ---------------------------------------------------------------------------

/**
 * Resolve the effective access authorization for a customer contact.
 *
 * @param tier - The contact's data tier from their profile.
 * @param confirmed - Whether the tier has been verified internally.
 * @param explicitScopes - Optional explicit scope overrides (from profile).
 *   When null/undefined, scopes are derived from the tier.
 */
export function authorizeCustomerAccess(
  tier: DataTier,
  confirmed: boolean,
  explicitScopes?: readonly DataAccessScope[] | null,
): AccessAuthorization {
  // Unconfirmed contacts above "unknown" are downgraded to "unknown" scopes
  // for sensitive capabilities, but keep their tier for display/logging.
  const effectiveTier: DataTier = confirmed ? tier : "unknown";

  const scopes: readonly DataAccessScope[] =
    confirmed && explicitScopes && explicitScopes.length > 0
      ? explicitScopes
      : DEFAULT_TIER_SCOPES[effectiveTier];

  const scopeSet = new Set(scopes);

  // Collect all capabilities from all granted scopes.
  // Guard against corrupted scope values that would cause a lookup miss.
  const capabilities = new Set<KingdeeCapability>();
  for (const scope of scopes) {
    const caps = SCOPE_CAPABILITIES[scope];
    if (caps) {
      for (const cap of caps) {
        capabilities.add(cap);
      }
    }
  }

  return {
    tier,
    confirmed,
    scopes,
    allowedCapabilities: capabilities,
    canQueryAR: scopeSet.has("company_finance"),
    canQueryAllOrders: scopeSet.has("company_ops"),
    canViewInvoiceInfo: scopeSet.has("company_finance"),
  };
}

// ---------------------------------------------------------------------------
// Field filtering helpers
// ---------------------------------------------------------------------------

/**
 * Get the set of allowed field names for sales query results,
 * based on the contact's effective scopes.
 */
export function resolveAllowedSalesFields(scopes: readonly DataAccessScope[]): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const scope of scopes) {
    const scopeFields = SALES_FIELDS_BY_SCOPE[scope];
    for (const f of scopeFields) {
      fields.add(f);
    }
  }
  // company_finance inherits all company_ops fields
  if (scopes.includes("company_finance")) {
    for (const f of SALES_FIELDS_BY_SCOPE.company_ops) {
      fields.add(f);
    }
  }
  return fields;
}

/**
 * Get the set of allowed field names for AR (accounts receivable) results.
 * Returns an empty set if the contact does not have company_finance scope.
 */
export function resolveAllowedARFields(scopes: readonly DataAccessScope[]): ReadonlySet<string> {
  if (!scopes.includes("company_finance")) {
    return new Set();
  }
  return AR_ALLOWED_FIELDS;
}

/**
 * Check whether a specific Kingdee CLI capability is allowed.
 */
export function isCapabilityAllowed(
  auth: AccessAuthorization,
  capability: KingdeeCapability,
): boolean {
  return auth.allowedCapabilities.has(capability);
}

// ---------------------------------------------------------------------------
// Convenience: human-readable denial message
// ---------------------------------------------------------------------------

/**
 * Generate a polite Chinese denial message when a contact tries to access
 * data beyond their authorization level.
 */
export function getDenialMessage(capability: KingdeeCapability, _tier: DataTier): string {
  const DENIAL_MESSAGES: Record<KingdeeCapability, string> = {
    master_query: "抱歉，您目前暂无权限查询客户主档信息。请联系贵公司负责人授权后再试。",
    sales_query: "抱歉，您目前暂无权限查看订单信息。请联系贵公司采购负责人。",
    arap_debt: "应收账款信息仅限贵公司负责人或财务人员查看。如需查询请联系贵公司财务负责人。",
    arap_statement: "对账单仅限贵公司负责人或财务人员查看。如需查询请联系贵公司财务负责人。",
    invoice_info: "开票信息仅限贵公司负责人或财务人员查看。如需查询请联系贵公司财务负责人。",
    inventory_query: "抱歉，暂时无法查询库存信息。请稍后再试。",
    price_query: "抱歉，暂时无法查询价格信息。请稍后再试。",
  };
  return DENIAL_MESSAGES[capability];
}
