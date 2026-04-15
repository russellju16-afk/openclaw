import { describe, expect, it } from "vitest";
import { applyKingdeeToolResultFilter } from "./kingdee-tool-result-filter.js";

function makeTextResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: undefined,
  };
}

const KINGDEE_CMD = "erpkit-kingdee-cosmic sales report --format json";
const LAIFU = "laifu";

describe("applyKingdeeToolResultFilter", () => {
  // --- agent scoping ---

  it("skips filter when agentId is undefined", () => {
    const result = makeTextResult('{"profit": 99999}');
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result);
    expect(filtered).toBe(result);
  });

  it("skips filter for non-laifu agents", () => {
    const result = makeTextResult('{"profit": 99999}');
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, "main");
    expect(filtered).toBe(result);
  });

  it("skips filter for laicai agent", () => {
    const result = makeTextResult('{"profit": 99999}');
    const filtered = applyKingdeeToolResultFilter(
      "exec",
      { command: KINGDEE_CMD },
      result,
      "laicai",
    );
    expect(filtered).toBe(result);
  });

  it("applies filter for laifu agent", () => {
    const result = makeTextResult('{"profit": 99999, "amount": 100}');
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, LAIFU);
    const parsed = JSON.parse((filtered.content[0] as { text: string }).text);
    expect(parsed).not.toHaveProperty("profit");
    expect(parsed.amount).toBe(100);
  });

  // --- tool type scoping ---

  it("passes through non-exec tools unchanged", () => {
    const result = makeTextResult('{"profit": 12345}');
    const filtered = applyKingdeeToolResultFilter("read", {}, result, LAIFU);
    expect(filtered).toBe(result);
  });

  it("passes through exec tools with non-kingdee commands unchanged", () => {
    const result = makeTextResult("some output");
    const filtered = applyKingdeeToolResultFilter("exec", { command: "ls -la" }, result, LAIFU);
    expect(filtered).toBe(result);
  });

  // --- JSON field filtering ---

  it("filters JSON fields from kingdee exec output", () => {
    const json = JSON.stringify({
      product_name: "大米",
      unit_price: 5.5,
      cost_price: 3.2,
      profit: 2.3,
      gross_margin: 0.42,
      supplier: "中粮集团",
      quantity: 100,
    });
    const result = makeTextResult(json);
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, LAIFU);
    const parsed = JSON.parse((filtered.content[0] as { text: string }).text);
    expect(parsed.product_name).toBe("大米");
    expect(parsed.unit_price).toBe(5.5);
    expect(parsed.quantity).toBe(100);
    expect(parsed).not.toHaveProperty("cost_price");
    expect(parsed).not.toHaveProperty("profit");
    expect(parsed).not.toHaveProperty("gross_margin");
    expect(parsed).not.toHaveProperty("supplier");
  });

  it("filters JSON arrays from kingdee exec output", () => {
    const json = JSON.stringify([
      { name: "花生油", price: 45, cost: 30, margin: 15 },
      { name: "大豆油", price: 40, cost: 25, margin: 15 },
    ]);
    const result = makeTextResult(json);
    const filtered = applyKingdeeToolResultFilter(
      "bash",
      { command: "erpkit-kingdee-cosmic finance balance --format json" },
      result,
      LAIFU,
    );
    const parsed = JSON.parse((filtered.content[0] as { text: string }).text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: "花生油", price: 45 });
    expect(parsed[1]).toEqual({ name: "大豆油", price: 40 });
  });

  it("handles JSON with prefix text (status messages)", () => {
    const text = 'Fetching data...\n{"product": "面粉", "cost_price": 2.0}';
    const result = makeTextResult(text);
    const filtered = applyKingdeeToolResultFilter(
      "exec",
      { command: "erpkit-kingdee-cosmic master materials --format json" },
      result,
      LAIFU,
    );
    const output = (filtered.content[0] as { text: string }).text;
    expect(output).toContain("Fetching data...");
    expect(output).not.toContain("cost_price");
    expect(output).toContain("product");
  });

  it("redacts financial text in prefix/suffix when JSON is present", () => {
    const text = '毛利率：32%\n{"product": "面粉", "cost_price": 2.0}\n净利润：50000';
    const result = makeTextResult(text);
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, LAIFU);
    const output = (filtered.content[0] as { text: string }).text;
    expect(output).not.toContain("cost_price");
    expect(output).not.toContain("32%");
    expect(output).not.toContain("50000");
    expect(output).toContain("product");
    expect(output).toContain("[REDACTED]");
  });

  // --- text-level redaction ---

  it("redacts financial text patterns in non-JSON output", () => {
    const text = "利润表摘要\n净利润：123,456.78\n毛利率：32.5%\n总收入：500,000";
    const result = makeTextResult(text);
    const filtered = applyKingdeeToolResultFilter(
      "exec",
      { command: "erpkit-kingdee-cosmic finance profit --period 2026-03" },
      result,
      LAIFU,
    );
    const output = (filtered.content[0] as { text: string }).text;
    expect(output).not.toContain("123,456.78");
    expect(output).not.toContain("32.5%");
    expect(output).toContain("总收入：500,000");
  });

  // --- edge cases ---

  it("preserves result when no sensitive data is found", () => {
    const json = JSON.stringify({
      customer_name: "张三",
      amount: 1000,
      date: "2026-01-01",
    });
    const result = makeTextResult(json);
    const filtered = applyKingdeeToolResultFilter(
      "exec",
      { command: "erpkit-kingdee-cosmic arap ar --format json" },
      result,
      LAIFU,
    );
    expect(filtered).toBe(result);
  });

  it("handles nested objects with blocked fields", () => {
    const json = JSON.stringify({
      order: {
        id: "SO-001",
        items: [{ name: "rice", price: 10, cost_price: 6, supplier: "XX" }],
      },
    });
    const result = makeTextResult(json);
    const filtered = applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, LAIFU);
    const parsed = JSON.parse((filtered.content[0] as { text: string }).text);
    expect(parsed.order.items[0]).toEqual({ name: "rice", price: 10 });
  });

  it("does not mutate the original result", () => {
    const json = JSON.stringify({ cost_price: 3.2 });
    const result = makeTextResult(json);
    const originalText = result.content[0].text;
    applyKingdeeToolResultFilter("exec", { command: KINGDEE_CMD }, result, LAIFU);
    expect(result.content[0].text).toBe(originalText);
  });
});
