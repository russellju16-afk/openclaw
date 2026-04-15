// ---------------------------------------------------------------------------
// Kingdee CLI tool-result filter.
//
// Intercepts bash/exec tool results from erpkit-kingdee-cosmic commands and
// removes sensitive financial fields (cost, profit, margin, supplier, etc.)
// before they reach the AI model context. This is a code-level enforcement
// layer that complements the LLM prompt instructions in AGENTS.md.
//
// The filter delegates to the field-level blocklist already defined in
// `src/customers/pii-filter.ts` (filterKingdeeResponse). All functions are
// pure — inputs are never modified.
// ---------------------------------------------------------------------------

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { filterKingdeeResponse } from "../customers/pii-filter.js";

const KINGDEE_CMD_RE = /erpkit-kingdee-cosmic\b/;

/**
 * Check whether a bash/exec command string invokes the Kingdee CLI.
 */
function isKingdeeCommand(command: string): boolean {
  return KINGDEE_CMD_RE.test(command);
}

/**
 * Extract the command string from bash/exec tool params.
 * Handles both `{ command: "..." }` and plain string params.
 */
function extractCommand(params: unknown): string | undefined {
  if (typeof params === "string") {
    return params;
  }
  if (params && typeof params === "object") {
    const record = params as Record<string, unknown>;
    if (typeof record.command === "string") {
      return record.command;
    }
    if (typeof record.cmd === "string") {
      return record.cmd;
    }
  }
  return undefined;
}

/**
 * Try to locate a JSON array or object within mixed text output,
 * parse it, apply field-level filtering, and re-serialize.
 * Returns the filtered text or null if no valid JSON was found.
 */
function extractAndFilterJson(text: string): string | null {
  const jsonStart = text.search(/[[{]/);
  if (jsonStart === -1) {
    return null;
  }
  const lastBrace = text.lastIndexOf("}");
  const lastBracket = text.lastIndexOf("]");
  const jsonEnd = Math.max(lastBrace, lastBracket);
  if (jsonEnd < jsonStart) {
    return null;
  }
  const candidate = text.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const filtered = Array.isArray(parsed)
      ? parsed.map((item) =>
          item !== null && typeof item === "object"
            ? filterKingdeeResponse(item as Record<string, unknown>)
            : item,
        )
      : filterKingdeeResponse(parsed as Record<string, unknown>);
    // Compare stringified output to detect whether any fields were removed.
    // If nothing changed, return null so the caller preserves the original text.
    const filteredJson = JSON.stringify(filtered, null, 2);
    const originalJson = JSON.stringify(parsed, null, 2);
    if (filteredJson === originalJson) {
      return null;
    }
    const prefix = jsonStart > 0 ? redactFinancialText(text.slice(0, jsonStart)) : "";
    const suffix = jsonEnd < text.length - 1 ? redactFinancialText(text.slice(jsonEnd + 1)) : "";
    return prefix + filteredJson + suffix;
  } catch {
    return null;
  }
}

/**
 * Regex patterns that match sensitive financial data in plain-text / table
 * output from the Kingdee CLI.
 */
const FINANCIAL_TEXT_PATTERNS: readonly RegExp[] = [
  // Chinese financial terms followed by numbers / amounts
  /(?:净利润|毛利润?|毛利率|净利率|利润率?|成本价|进价|采购价|进货价|供应商|供货商)\s*[:：]?\s*[-\d,.%￥¥]+/g,
  // English field-name style (table headers or key=value)
  /(?:net_profit|gross_profit|profit_margin|cost_price|purchase_cost|gross_margin|markup|net_income|total_profit)\s*[=:||\t]\s*[-\d,.%]+/gi,
];

const FINANCIAL_REDACTION = "[REDACTED]";

/**
 * Apply regex-based redaction for financial data in non-JSON output.
 */
function redactFinancialText(text: string): string {
  let result = text;
  for (const pattern of FINANCIAL_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, FINANCIAL_REDACTION);
  }
  return result;
}

/**
 * Filter the text content of a Kingdee CLI tool result.
 * Tries JSON-level field filtering first; falls back to text-level regex.
 */
function filterOutputText(text: string): string {
  const jsonFiltered = extractAndFilterJson(text);
  if (jsonFiltered !== null) {
    return jsonFiltered;
  }
  return redactFinancialText(text);
}

/**
 * Agent IDs whose Kingdee CLI output should be filtered.
 * Only agents that serve internal employees (not the owner/boss) are listed.
 */
const FILTERED_AGENT_IDS: ReadonlySet<string> = new Set(["laifu", "laicai"]);

/**
 * Apply Kingdee field-level filtering to a bash/exec tool result.
 *
 * Filtering is scoped to specific agents (see FILTERED_AGENT_IDS) so that
 * owner/boss agents retain full access to financial data.
 *
 * If the tool is not a bash/exec tool, the command is not a Kingdee CLI
 * invocation, or the agent is not in the filtered set, the result is
 * returned unmodified.
 */
export function applyKingdeeToolResultFilter(
  toolName: string,
  params: unknown,
  result: AgentToolResult<unknown>,
  agentId?: string,
): AgentToolResult<unknown> {
  if (!agentId || !FILTERED_AGENT_IDS.has(agentId)) {
    return result;
  }
  const normalizedTool = toolName.trim().toLowerCase();
  if (normalizedTool !== "exec" && normalizedTool !== "bash") {
    return result;
  }
  const command = extractCommand(params);
  if (!command || !isKingdeeCommand(command)) {
    return result;
  }
  if (!Array.isArray(result.content)) {
    return result;
  }
  let modified = false;
  const filteredContent = result.content.map((block) => {
    const rec = block as { type?: string; text?: string };
    if (rec.type !== "text" || typeof rec.text !== "string") {
      return block;
    }
    const filtered = filterOutputText(rec.text);
    if (filtered !== rec.text) {
      modified = true;
      return { ...block, text: filtered };
    }
    return block;
  });
  if (!modified) {
    return result;
  }
  return { ...result, content: filteredContent } as AgentToolResult<unknown>;
}
