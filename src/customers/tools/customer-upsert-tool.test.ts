import { describe, expect, it } from "vitest";
import { ToolInputError } from "../../agents/tools/common.js";
import { type PendingNotification, validatePendingNotifications } from "./customer-upsert-tool.js";

describe("validatePendingNotifications", () => {
  const valid: PendingNotification = {
    type: "complaint",
    created_at: "2026-01-01T10:00:00Z",
    summary: "Customer reported spoiled rice batch.",
    urgency: "high",
  };

  it("accepts a well-formed notification", () => {
    const result = validatePendingNotifications(JSON.stringify([valid]));
    expect(result).toEqual([valid]);
  });

  it("accepts an empty array", () => {
    expect(validatePendingNotifications("[]")).toEqual([]);
  });

  it("strips unknown keys from each item", () => {
    const withExtra = { ...valid, injected_field: "evil", __proto__: "bad" };
    const result = validatePendingNotifications(JSON.stringify([withExtra]));
    expect(result[0]).toEqual(valid);
    expect("injected_field" in result[0]).toBe(false);
  });

  it("truncates summary to 500 characters", () => {
    const longSummary = "a".repeat(600);
    const result = validatePendingNotifications(
      JSON.stringify([{ ...valid, summary: longSummary }]),
    );
    expect(result[0].summary).toHaveLength(500);
  });

  it("rejects invalid type", () => {
    expect(() =>
      validatePendingNotifications(JSON.stringify([{ ...valid, type: "promotion" }])),
    ).toThrow(ToolInputError);
  });

  it("rejects invalid urgency", () => {
    expect(() =>
      validatePendingNotifications(JSON.stringify([{ ...valid, urgency: "critical" }])),
    ).toThrow(ToolInputError);
  });

  it("rejects missing created_at", () => {
    const { created_at: _drop, ...noDate } = valid;
    expect(() => validatePendingNotifications(JSON.stringify([noDate]))).toThrow(ToolInputError);
  });

  it("rejects non-string summary", () => {
    expect(() => validatePendingNotifications(JSON.stringify([{ ...valid, summary: 42 }]))).toThrow(
      ToolInputError,
    );
  });

  it("rejects non-array JSON", () => {
    expect(() => validatePendingNotifications(JSON.stringify({ type: "complaint" }))).toThrow(
      ToolInputError,
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => validatePendingNotifications("not-json")).toThrow(ToolInputError);
  });

  it("rejects a non-object array item", () => {
    expect(() => validatePendingNotifications(JSON.stringify(["complaint"]))).toThrow(
      ToolInputError,
    );
  });

  it("accepts all valid types", () => {
    for (const type of ["complaint", "dispute", "transfer", "other"] as const) {
      const result = validatePendingNotifications(JSON.stringify([{ ...valid, type }]));
      expect(result[0].type).toBe(type);
    }
  });

  it("accepts all valid urgencies", () => {
    for (const urgency of ["high", "medium", "low"] as const) {
      const result = validatePendingNotifications(JSON.stringify([{ ...valid, urgency }]));
      expect(result[0].urgency).toBe(urgency);
    }
  });
});
