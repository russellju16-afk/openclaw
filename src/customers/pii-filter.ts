// ---------------------------------------------------------------------------
// PII detection/masking and Kingdee field filtering utilities.
//
// These functions act as a code-level safety net to complement the LLM
// prompt instructions that guard 小超 customer-facing output. All functions
// are pure and immutable — inputs are never modified.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PII masking
// ---------------------------------------------------------------------------

export interface PIIDetection {
  type: "phone" | "bank_account" | "id_card";
  /** Slice of the original text that was matched. */
  original: string;
  /** Replacement that was applied in the masked output. */
  masked: string;
  /** Character offset of the match in the original text. */
  index: number;
}

/**
 * Mask a Chinese mobile phone number.
 * Example: 13812345678 → 138****5678
 * Keeps the first 3 digits (carrier prefix) and last 4 digits visible.
 */
export function maskPhone(phone: string): string {
  // Strip common separators and +86 country code prefix.
  const digits = phone.replace(/[\s\-+().]/g, "").replace(/^86/, "");
  if (digits.length !== 11) {
    return phone;
  }
  return `${digits.slice(0, 3)}****${digits.slice(7)}`;
}

/**
 * Mask a bank account number (16-19 digits).
 * Example: 6228480012345678 → 6228****5678
 * Keeps the first 4 and last 4 digits visible.
 */
export function maskBankAccount(account: string): string {
  const digits = account.replace(/[\s-]/g, "");
  if (digits.length < 15 || digits.length > 19) {
    return account;
  }
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

/**
 * Mask a Chinese national ID card number (18 digits or 17 digits + X).
 * Example: 610104199001011234 → 610104**********34
 * Keeps the first 6 (region code) and last 2 characters visible.
 */
export function maskIdCard(id: string): string {
  if (!/^\d{17}[\dX]$/i.test(id)) {
    return id;
  }
  return `${id.slice(0, 6)}**********${id.slice(-2)}`;
}

// Regex patterns used by scanAndMaskPII.
// Order matters: more specific patterns come first.

/** Chinese ID card: 18 digits or 17 digits followed by X/x. */
const RE_ID_CARD = /(?<!\d)(\d{17}[\dX])(?!\d)/gi;

/**
 * Chinese mobile: 11 digits starting with 1[3-9], optionally prefixed with +86.
 * Uses digit-boundary anchors so it does not match a substring of a longer
 * digit run (bank accounts start with 6 so there is no ambiguity there, but
 * we still want to avoid false positives in mixed-digit strings).
 */
const RE_PHONE = /(?<!\d)(?:\+86)?(1[3-9]\d{9})(?!\d)/g;

/**
 * Bank account: 16-19 consecutive digits NOT already matched as a phone or ID.
 * The leading-digit exclusion for 1[3-9] is handled by processing order —
 * phone and ID regexes run first and their matches are replaced before this
 * pattern runs on the remaining text.
 */
const RE_BANK = /(?<!\d)(\d{15,19})(?!\d)/g;

/**
 * Scan free-form text for unmasked PII and replace each occurrence.
 * Returns the masked string and a list of detections (for logging/auditing).
 * Runs in order: ID card → phone → bank account.
 */
export function scanAndMaskPII(text: string): {
  masked: string;
  detections: PIIDetection[];
} {
  const detections: PIIDetection[] = [];
  let masked = text;

  // Helper that applies a regex pass and records detections.
  // We rebuild `masked` each pass so subsequent regex offsets stay accurate
  // for logging purposes (we record the offset into the *original* text).
  function applyMask(re: RegExp, type: PIIDetection["type"], maskFn: (s: string) => string): void {
    re.lastIndex = 0;
    masked = masked.replace(re, (match, capture: string, offset: number) => {
      const replacement = maskFn(capture ?? match);
      detections.push({
        type,
        original: match,
        masked: replacement,
        index: offset,
      });
      return replacement;
    });
  }

  applyMask(RE_ID_CARD, "id_card", maskIdCard);
  applyMask(RE_PHONE, "phone", maskPhone);
  applyMask(RE_BANK, "bank_account", maskBankAccount);

  return { masked, detections };
}

// ---------------------------------------------------------------------------
// Kingdee field blocklist
// ---------------------------------------------------------------------------

/**
 * Exact field name matches (case-sensitive, matching typical Kingdee/snake_case
 * keys returned by ERP API wrappers).
 */
export const KINGDEE_BLOCKED_FIELDS: ReadonlySet<string> = new Set([
  // Cost / purchase price
  "cost_price",
  "purchase_cost",
  "buy_price",
  "cost",
  "unit_cost",
  // Profit
  "profit",
  "gross_profit",
  "net_profit",
  "profit_margin",
  // Margin / markup
  "margin",
  "gross_margin",
  "markup",
  // Supplier / vendor
  "supplier",
  "supplier_name",
  "supplier_id",
  "vendor",
  "vendor_name",
  // Internal annotations
  "internal_note",
  "internal_memo",
  "collection_note",
  "bad_debt",
  // Credit / discount / customer classification
  "credit_limit",
  "customer_grade",
  "customer_level",
  "discount",
  "discount_rate",
  "rebate",
]);

/**
 * Pattern-based field name blockers. These catch variations and camelCase
 * equivalents that exact-match would miss.
 *
 * IMPORTANT — false-positive guard:
 *  - /cost/i would match "customer" → excluded via negative lookahead (?!omer)
 *  - /margin/i is safe (no common safe field contains "margin")
 *  - /supplier|vendor/i is safe
 *  - /internal/i is safe
 *  - /profit/i is safe
 */
export const KINGDEE_BLOCKED_PATTERNS: readonly RegExp[] = [
  // "cost" but NOT "customer" or "discount"
  /(?<![a-z])cost(?!omer|[a-z])/i,
  /profit/i,
  /margin/i,
  /supplier|vendor/i,
  /internal/i,
];

/** Returns true if a field name should be blocked from customer output. */
function isBlockedField(key: string): boolean {
  if (KINGDEE_BLOCKED_FIELDS.has(key)) {
    return true;
  }
  return KINGDEE_BLOCKED_PATTERNS.some((re) => re.test(key));
}

// ---------------------------------------------------------------------------
// Recursive object filter (blocklist mode)
// ---------------------------------------------------------------------------

/**
 * Filter a Kingdee JSON response, removing all blocked fields recursively.
 * Returns a new object — the input is never mutated.
 * Works on plain objects and arrays; non-object values are returned as-is.
 */
export function filterKingdeeResponse<T extends Record<string, unknown>>(data: T): T {
  return filterValue(data) as T;
}

function filterValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(filterValue);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (!isBlockedField(key)) {
        result[key] = filterValue(val);
      }
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Recursive object filter (whitelist mode)
// ---------------------------------------------------------------------------

/**
 * Keep only the explicitly allowed top-level fields from a Kingdee response
 * object. Nested objects inside allowed fields are kept intact (this is
 * whitelist at the top level only — use filterKingdeeResponse for deep
 * blocking within nested structures if needed).
 * Returns a new partial object — the input is never mutated.
 */
export function filterKingdeeByWhitelist<T extends Record<string, unknown>>(
  data: T,
  allowedFields: ReadonlySet<string>,
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const val = data[key];
      // Apply deep blocklist filtering to nested values within whitelisted fields.
      (result as Record<string, unknown>)[key] =
        val !== null && typeof val === "object" ? filterValue(val) : val;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sales query whitelist
// ---------------------------------------------------------------------------

/**
 * Allowed fields for customer-facing sales query output (kingdee-sales).
 * Contains only fields that are safe to expose: dates, product info,
 * quantities, sale price, totals, document references, and remarks.
 * Notably absent: cost_price, supplier, profit, margin, internal_note.
 */
export const SALES_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
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
  "selling_price",
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
]);
