// ---------------------------------------------------------------------------
// PII guard for Feishu customer-facing outbound messages.
//
// Security: agent replies may contain unmasked PII (phone numbers, bank
// accounts, ID cards) learned from tool calls like customer_get. This module
// provides a last-line-of-defence scan that masks PII before text leaves the
// process and is delivered to the customer's Feishu chat.
//
// All functions are pure and immutable — inputs are never modified.
// ---------------------------------------------------------------------------

export type OutboundPIIDetection = {
  type: "phone" | "bank_account" | "id_card" | "financial";
  masked: string;
  index: number;
};

/** Chinese ID card: 18 digits or 17 digits + X/x. */
const RE_ID_CARD = /(?<!\d)(\d{17}[\dX])(?!\d)/gi;

/**
 * Chinese mobile: 11 digits starting with 1[3-9], optionally prefixed +86.
 * Also matches common formatted variants with spaces/dashes between groups.
 * Digit-boundary anchors prevent false positives inside longer digit runs.
 */
const RE_PHONE = /(?<!\d)(?:\+?86[\s-]*)?(1[3-9]\d[\s-]?\d{4}[\s-]?\d{4})(?!\d)/g;

/**
 * Bank account: 15-19 consecutive digits NOT already consumed as phone/ID.
 * 15-digit lower bound covers Chinese postal savings accounts.
 * Also matches space/dash-separated groups (e.g. "6228 4800 1234 5678").
 * Processing order ensures phone/ID patterns are replaced first.
 */
const RE_BANK = /(?<!\d)(\d(?:[\s-]?\d){14,18})(?!\d)/g;

function maskPhone(raw: string): string {
  // Strip separators and +86 prefix to get bare 11 digits.
  const digits = raw.replace(/[\s\-+().]/g, "").replace(/^86/, "");
  if (digits.length !== 11) {return raw;}
  return `${digits.slice(0, 3)}****${digits.slice(7)}`;
}

function maskBankAccount(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "");
  if (digits.length < 15 || digits.length > 19) {return raw;}
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function maskIdCard(id: string): string {
  return `${id.slice(0, 6)}**********${id.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Financial data redaction (last-line defence for sensitive ERP fields)
// ---------------------------------------------------------------------------

/**
 * Patterns that match sensitive financial figures in natural-language or
 * structured text output. These catch cases where the AI model includes
 * cost/profit/margin data despite prompt-level instructions.
 *
 * Each regex is reset before use to avoid stale lastIndex state.
 */
const FINANCIAL_PATTERNS: readonly {
  re: RegExp;
  type: "financial";
}[] = [
  // Chinese: "净利润：12,345.67" / "毛利率 32.5%"
  {
    re: /(?:净利润|毛利润?|毛利率|净利率|利润率?|成本价|进价|采购价|进货价)\s*[:：]?\s*[-\d,.%￥¥]+/g,
    type: "financial",
  },
  // Chinese: "供应商：XX公司" (supplier names after the label)
  {
    re: /(?:供应商|供货商|供货渠道)\s*[:：]\s*[\u4e00-\u9fff\w]+/g,
    type: "financial",
  },
];

const FINANCIAL_REDACTION = "***";

/**
 * Scan outbound text for unmasked PII and replace each occurrence.
 * Returns the masked string and a list of detections for audit logging.
 * Processing order: ID card → phone → bank account → financial data.
 */
export function guardOutboundPII(text: string): {
  text: string;
  detections: OutboundPIIDetection[];
} {
  const detections: OutboundPIIDetection[] = [];
  let masked = text;

  function applyMask(
    re: RegExp,
    type: OutboundPIIDetection["type"],
    maskFn: (s: string) => string,
  ): void {
    re.lastIndex = 0;
    masked = masked.replace(re, (match, capture: string, offset: number) => {
      const replacement = maskFn(capture ?? match);
      detections.push({ type, masked: replacement, index: offset });
      return replacement;
    });
  }

  applyMask(RE_ID_CARD, "id_card", maskIdCard);
  applyMask(RE_PHONE, "phone", maskPhone);
  applyMask(RE_BANK, "bank_account", maskBankAccount);

  // Financial data redaction — belt-and-suspenders for ERP field leaks.
  for (const pattern of FINANCIAL_PATTERNS) {
    pattern.re.lastIndex = 0;
    masked = masked.replace(pattern.re, (match, _capture: string, offset: number) => {
      detections.push({
        type: "financial",
        masked: FINANCIAL_REDACTION,
        index: offset,
      });
      return FINANCIAL_REDACTION;
    });
  }

  return { text: masked, detections };
}
