import { describe, expect, it } from "vitest";
import {
  maskPhone,
  maskBankAccount,
  maskIdCard,
  scanAndMaskPII,
  KINGDEE_BLOCKED_FIELDS,
  KINGDEE_BLOCKED_PATTERNS,
  filterKingdeeResponse,
  filterKingdeeByWhitelist,
  SALES_ALLOWED_FIELDS,
} from "./pii-filter.js";

// ---------------------------------------------------------------------------
// PII masking
// ---------------------------------------------------------------------------

describe("maskPhone", () => {
  it("masks a standard 11-digit mobile number", () => {
    expect(maskPhone("13812345678")).toBe("138****5678");
  });

  it("strips common separators before masking", () => {
    expect(maskPhone("138-1234-5678")).toBe("138****5678");
    expect(maskPhone("138 1234 5678")).toBe("138****5678");
  });

  it("handles +86 prefix", () => {
    expect(maskPhone("+8613812345678")).toBe("138****5678");
    expect(maskPhone("+86 138 1234 5678")).toBe("138****5678");
  });

  it("returns input unchanged when not 11 digits", () => {
    expect(maskPhone("1234567")).toBe("1234567");
    expect(maskPhone("138123456789")).toBe("138123456789");
    expect(maskPhone("")).toBe("");
  });
});

describe("maskBankAccount", () => {
  it("masks a 16-digit account", () => {
    expect(maskBankAccount("6228480012345678")).toBe("6228****5678");
  });

  it("masks a 19-digit account", () => {
    expect(maskBankAccount("6228480012345678901")).toBe("6228****8901");
  });

  it("strips spaces", () => {
    expect(maskBankAccount("6228 4800 1234 5678")).toBe("6228****5678");
  });

  it("strips dashes", () => {
    expect(maskBankAccount("6228-4800-1234-5678")).toBe("6228****5678");
  });

  it("masks a 15-digit account (postal savings)", () => {
    expect(maskBankAccount("622848001234567")).toBe("6228****4567");
  });

  it("returns input unchanged when length is out of range", () => {
    expect(maskBankAccount("12345678901234")).toBe("12345678901234"); // 14 digits
    expect(maskBankAccount("12345678901234567890")).toBe("12345678901234567890"); // 20 digits
  });
});

describe("maskIdCard", () => {
  it("masks a standard 18-digit ID", () => {
    expect(maskIdCard("610104199001011234")).toBe("610104**********34");
  });

  it("masks an ID ending with X", () => {
    expect(maskIdCard("61010419900101123X")).toBe("610104**********3X");
  });

  it("is case-insensitive for trailing X", () => {
    expect(maskIdCard("61010419900101123x")).toBe("610104**********3x");
  });

  it("returns input unchanged for invalid format", () => {
    expect(maskIdCard("12345")).toBe("12345");
    expect(maskIdCard("6101041990010112YY")).toBe("6101041990010112YY");
  });
});

describe("scanAndMaskPII", () => {
  it("masks phone numbers in free text", () => {
    const result = scanAndMaskPII("联系人电话：13812345678");
    expect(result.masked).toBe("联系人电话：138****5678");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe("phone");
  });

  it("masks phone numbers with +86 prefix", () => {
    const result = scanAndMaskPII("电话：+8613812345678");
    expect(result.masked).toBe("电话：138****5678");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe("phone");
  });

  it("masks bank accounts in free text", () => {
    const result = scanAndMaskPII("开户行账号：6228480012345678");
    expect(result.masked).toBe("开户行账号：6228****5678");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe("bank_account");
  });

  it("masks ID cards in free text", () => {
    const result = scanAndMaskPII("身份证：610104199001011234");
    expect(result.masked).toBe("身份证：610104**********34");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe("id_card");
  });

  it("masks multiple PII types in one string", () => {
    const text = "姓名张三，电话13912345678，身份证610104199001011234";
    const result = scanAndMaskPII(text);
    expect(result.masked).toContain("139****5678");
    expect(result.masked).toContain("610104**********34");
    expect(result.detections).toHaveLength(2);
  });

  it("returns unchanged text when no PII found", () => {
    const text = "今天天气不错";
    const result = scanAndMaskPII(text);
    expect(result.masked).toBe(text);
    expect(result.detections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Kingdee field blocklist
// ---------------------------------------------------------------------------

describe("KINGDEE_BLOCKED_FIELDS", () => {
  it("blocks cost-related fields", () => {
    expect(KINGDEE_BLOCKED_FIELDS.has("cost_price")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("purchase_cost")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("unit_cost")).toBe(true);
  });

  it("blocks profit fields", () => {
    expect(KINGDEE_BLOCKED_FIELDS.has("profit")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("gross_profit")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("profit_margin")).toBe(true);
  });

  it("blocks supplier fields", () => {
    expect(KINGDEE_BLOCKED_FIELDS.has("supplier")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("supplier_name")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("vendor")).toBe(true);
  });

  it("blocks internal note fields", () => {
    expect(KINGDEE_BLOCKED_FIELDS.has("internal_note")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("bad_debt")).toBe(true);
  });

  it("blocks credit/discount/customer classification fields", () => {
    expect(KINGDEE_BLOCKED_FIELDS.has("credit_limit")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("customer_grade")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("discount")).toBe(true);
    expect(KINGDEE_BLOCKED_FIELDS.has("rebate")).toBe(true);
  });
});

describe("KINGDEE_BLOCKED_PATTERNS", () => {
  it("matches cost-related field names via pattern", () => {
    const matches = (name: string) => KINGDEE_BLOCKED_PATTERNS.some((re) => re.test(name));
    expect(matches("cost_total")).toBe(true);
    expect(matches("total_cost")).toBe(true); // underscore is not a letter, so cost is matched
  });

  it("does not false-positive on safe fields", () => {
    const matches = (name: string) => KINGDEE_BLOCKED_PATTERNS.some((re) => re.test(name));
    // "customer" should NOT be blocked
    expect(matches("customer_name")).toBe(false);
    expect(matches("customer_id")).toBe(false);
  });
});

describe("filterKingdeeResponse", () => {
  it("removes blocked fields from flat objects", () => {
    const data = {
      product_name: "大米",
      unit_price: 5.5,
      cost_price: 3.2,
      profit: 2.3,
      supplier: "XX供应商",
    };
    const filtered = filterKingdeeResponse(data);
    expect(filtered).toEqual({
      product_name: "大米",
      unit_price: 5.5,
    });
  });

  it("removes blocked fields recursively from nested objects", () => {
    const data = {
      order_id: "SO-001",
      items: [
        {
          name: "花生油",
          price: 45,
          cost: 30,
          margin: 15,
        },
      ],
    };
    const filtered = filterKingdeeResponse(data);
    expect(filtered).toEqual({
      order_id: "SO-001",
      items: [
        {
          name: "花生油",
          price: 45,
        },
      ],
    });
  });

  it("preserves non-blocked fields intact", () => {
    const data = {
      customer_name: "张三",
      quantity: 100,
      amount: 550,
    };
    const filtered = filterKingdeeResponse(data);
    expect(filtered).toEqual(data);
  });

  it("does not mutate the input", () => {
    const data = { product: "面粉", cost_price: 2.0 };
    const copy = { ...data };
    filterKingdeeResponse(data);
    expect(data).toEqual(copy);
  });
});

describe("filterKingdeeByWhitelist", () => {
  it("keeps only whitelisted fields", () => {
    const data = {
      date: "2026-01-01",
      product_name: "大米",
      unit_price: 5.5,
      cost_price: 3.2,
      supplier: "XX",
    };
    const filtered = filterKingdeeByWhitelist(data, SALES_ALLOWED_FIELDS);
    expect(filtered).toEqual({
      date: "2026-01-01",
      product_name: "大米",
      unit_price: 5.5,
    });
  });

  it("applies deep blocklist filtering within whitelisted fields", () => {
    const data = {
      date: "2026-01-01",
      remark: {
        text: "备注",
        cost_price: 3.2,
        supplier: "XX供应商",
      },
    };
    const filtered = filterKingdeeByWhitelist(data, SALES_ALLOWED_FIELDS);
    expect(filtered).toEqual({
      date: "2026-01-01",
      remark: {
        text: "备注",
      },
    });
  });

  it("does not mutate the input", () => {
    const data = { date: "2026-01-01", supplier: "XX" };
    const copy = { ...data };
    filterKingdeeByWhitelist(data, SALES_ALLOWED_FIELDS);
    expect(data).toEqual(copy);
  });
});

describe("SALES_ALLOWED_FIELDS", () => {
  it("includes sale price fields", () => {
    expect(SALES_ALLOWED_FIELDS.has("unit_price")).toBe(true);
    expect(SALES_ALLOWED_FIELDS.has("sale_price")).toBe(true);
  });

  it("does not include cost/profit/supplier fields", () => {
    expect(SALES_ALLOWED_FIELDS.has("cost_price")).toBe(false);
    expect(SALES_ALLOWED_FIELDS.has("profit")).toBe(false);
    expect(SALES_ALLOWED_FIELDS.has("supplier")).toBe(false);
    expect(SALES_ALLOWED_FIELDS.has("margin")).toBe(false);
  });
});
