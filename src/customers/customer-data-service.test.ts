import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { CustomerDataService } from "./customer-data-service.js";
import { createCustomerDemandSignalsTool } from "./tools/customer-demand-signals-tool.js";
import { createCustomerDossierTool } from "./tools/customer-dossier-tool.js";
import { createCustomerGetTool } from "./tools/customer-get-tool.js";
import { createCustomerIntentCandidatesTool } from "./tools/customer-intent-candidates-tool.js";
import { createCustomerInvoiceTool } from "./tools/customer-invoice-tool.js";
import { createCustomerRecordInteractionTool } from "./tools/customer-record-interaction-tool.js";
import { createCustomerSafePricingTool } from "./tools/customer-safe-pricing-tool.js";
import { createCustomerUpsertTool } from "./tools/customer-upsert-tool.js";

const tempDirs: string[] = [];

async function createTempEnv(): Promise<{ root: string; dbPath: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclaw-enterprise-test-"));
  const stateDir = path.join(root, "state");
  const dbPath = path.join(root, "enterprise.db");
  tempDirs.push(root);
  vi.stubEnv("ENTERPRISE_DB", dbPath);
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  seedEnterpriseDb(dbPath);
  return { root, dbPath, stateDir };
}

function seedEnterpriseDb(dbPath: string): void {
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      job_title TEXT,
      company_name TEXT,
      company_address TEXT,
      tax_id TEXT,
      bank_name TEXT,
      bank_account TEXT,
      invoice_address TEXT,
      invoice_phone TEXT,
      main_categories TEXT,
      monthly_avg_amount REAL,
      preferred_brands TEXT,
      kingdee_id TEXT,
      kingdee_customer_name TEXT,
      status TEXT DEFAULT 'pending',
      consent_given_at TEXT,
      onboarding_sent_at TEXT,
      opt_out_proactive INTEGER DEFAULT 0,
      last_conversation_date TEXT,
      daily_proactive_sent_date TEXT,
      next_to_ask TEXT,
      declined_fields TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0,
      data_tier TEXT DEFAULT 'unknown',
      tier_confirmed INTEGER DEFAULT 0,
      verification_method TEXT,
      verified_by TEXT,
      verified_at TEXT,
      review_due_at TEXT
    );
    CREATE TABLE party_nodes (
      id TEXT PRIMARY KEY,
      root_account_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT,
      status TEXT DEFAULT 'active',
      parent_id TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE party_edges (
      id TEXT PRIMARY KEY,
      from_party_id TEXT NOT NULL,
      to_party_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE party_external_refs (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_value TEXT NOT NULL,
      source_system TEXT,
      is_primary INTEGER DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL,
      invoice_type TEXT,
      buyer_name TEXT NOT NULL,
      buyer_tax_id TEXT,
      seller_name TEXT,
      seller_tax_id TEXT,
      invoice_date TEXT,
      amount_incl_tax INTEGER,
      amount_excl_tax INTEGER,
      tax_amount INTEGER,
      items_json TEXT,
      remark TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      source_system TEXT,
      source_key TEXT,
      is_deleted INTEGER DEFAULT 0,
      kingdee_bill_no TEXT,
      pdf_path TEXT
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      file_id TEXT,
      title TEXT NOT NULL,
      counterparty TEXT,
      supplier_id TEXT,
      amount_cents INTEGER,
      currency TEXT DEFAULT 'CNY',
      issue_date TEXT,
      expires_at TEXT,
      risk_level TEXT,
      status TEXT DEFAULT 'active',
      review_conclusion TEXT,
      review_notes TEXT,
      submitter TEXT,
      region TEXT,
      extracted_json TEXT,
      keywords TEXT,
      search_terms TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      source_system TEXT,
      source_key TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE artifact_party_links (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      scope_mode TEXT DEFAULT 'leaf',
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE company_contacts (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      supplier_id TEXT,
      customer_id TEXT,
      contact_name TEXT NOT NULL,
      job_title TEXT,
      phone TEXT,
      department TEXT,
      location_name TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE customer_locations (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      customer_name TEXT NOT NULL,
      location_type TEXT NOT NULL,
      location_name TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      city TEXT,
      district TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0,
      customer_id TEXT
    );
    CREATE TABLE interaction_threads (
      id TEXT PRIMARY KEY,
      root_account_id TEXT NOT NULL,
      channel TEXT,
      external_user_id TEXT,
      current_party_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE interaction_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      root_account_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      content_text TEXT,
      payload_json TEXT,
      happened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT
    );
    CREATE TABLE sales_outbound_headers (
      bill_id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL UNIQUE,
      bill_date TEXT NOT NULL,
      bill_status TEXT,
      customer_id TEXT,
      customer_name TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      total_qty REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      currency_id TEXT,
      remark TEXT,
      operator_id TEXT,
      operator_name TEXT,
      audit_date TEXT,
      void_at TEXT,
      raw_json TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
      updated_at TEXT,
      customer_code TEXT,
      source_synced_at TEXT,
      created_at TEXT
    );
    CREATE TABLE sales_outbound_lines (
      line_id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      bill_no TEXT NOT NULL,
      bill_date TEXT NOT NULL,
      line_no INTEGER,
      customer_id TEXT,
      customer_name TEXT,
      material_id TEXT NOT NULL,
      material_name TEXT,
      material_model TEXT,
      unit_id TEXT,
      unit_name TEXT,
      qty REAL DEFAULT 0,
      price REAL DEFAULT 0,
      tax_price REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      all_amount REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      src_bill_no TEXT,
      raw_json TEXT,
      is_deleted INTEGER DEFAULT 0,
      updated_at TEXT,
      source_synced_at TEXT,
      created_at TEXT,
      UNIQUE(bill_id, line_no, material_id)
    );
    CREATE TABLE product_master_active (
      material_id TEXT PRIMARY KEY,
      product_code TEXT,
      name TEXT NOT NULL,
      category TEXT,
      spec TEXT,
      unit_name TEXT,
      keywords_json TEXT,
      last_sale_date TEXT,
      sales_180d_count INTEGER DEFAULT 0,
      avg_tax_price_180d REAL DEFAULT 0,
      active_reason TEXT,
      source_synced_at TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      display_name TEXT,
      category TEXT NOT NULL,
      spec TEXT,
      unit TEXT,
      avg_price REAL,
      tax_code TEXT,
      tax_rate TEXT,
      frequency INTEGER DEFAULT 0,
      brand TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    );
  `);

  db.prepare(
    `INSERT INTO party_nodes (id, root_account_id, node_type, name, display_name, parent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("root-acme", "root-acme", "root_account", "Acme Group", "Acme Group", null);
  db.prepare(
    `INSERT INTO party_nodes (id, root_account_id, node_type, name, display_name, parent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("pty-acme-store", "root-acme", "store", "Acme Store", "Acme Store", "root-acme");
  db.prepare(
    `INSERT INTO party_edges (id, from_party_id, to_party_id, edge_type) VALUES (?, ?, ?, ?)`,
  ).run("edge-1", "root-acme", "pty-acme-store", "parent_of");
  db.prepare(
    `INSERT INTO party_external_refs (id, party_id, ref_type, ref_value, source_system, is_primary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ref-1", "pty-acme-store", "kingdee_id", "830", "test", 1);
  db.prepare(
    `INSERT INTO party_external_refs (id, party_id, ref_type, ref_value, source_system, is_primary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ref-2", "pty-acme-store", "company_name", "Acme Store", "test", 1);

  db.prepare(
    `INSERT INTO customers (
      id, channel, channel_user_id, company_name, kingdee_id, tax_id, bank_name, bank_account,
      invoice_address, invoice_phone, status, data_tier, tier_confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "cust-1",
    "wecom",
    "peer-1",
    "Acme Store",
    "830",
    "91330123TEST",
    "招商银行",
    "6222334455667788",
    "西安市长安区",
    "18000000000",
    "confirmed",
    "boss",
    1,
  );
  db.prepare(
    `INSERT INTO customers (
      id, channel, channel_user_id, company_name, status, data_tier, tier_confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("cust-2", "wecom", "peer-2", "Fallback Co", "pending", "unknown", 0);

  db.prepare(
    `INSERT INTO invoices (
      id, invoice_number, buyer_name, invoice_date, amount_incl_tax, status, source_system, source_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("inv-1", "FP-001", "Acme Store", "2026-04-01", 128000, "active", "test", "inv-key-1");
  db.prepare(
    `INSERT INTO artifact_party_links (
      id, party_id, entity_type, entity_id, relation_type, is_primary, scope_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("apl-1", "pty-acme-store", "invoice", "inv-1", "billed_to", 1, "leaf");

  db.prepare(
    `INSERT INTO documents (
      id, doc_type, title, counterparty, status, issue_date, source_system, source_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "doc-1",
    "contract",
    "Acme 食用油采购合同",
    "Acme Store",
    "active",
    "2026-03-20",
    "test",
    "doc-key-1",
  );
  db.prepare(
    `INSERT INTO sales_outbound_headers (
      bill_id, bill_no, bill_date, bill_status, customer_id, customer_name, total_qty, total_amount,
      currency_id, updated_at, customer_code, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "bill-1",
    "XSCK-001",
    "2026-03-01",
    "C",
    "830",
    "Acme Store",
    10,
    1500,
    "CNY",
    "2026-03-01T00:00:00.000Z",
    "001.01",
    "2026-03-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sales_outbound_headers (
      bill_id, bill_no, bill_date, bill_status, customer_id, customer_name, total_qty, total_amount,
      currency_id, updated_at, customer_code, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "bill-2",
    "XSCK-002",
    "2026-03-08",
    "C",
    "830",
    "Acme Store",
    12,
    1800,
    "CNY",
    "2026-03-08T00:00:00.000Z",
    "001.01",
    "2026-03-08T00:00:00.000Z",
    "2026-03-08T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sales_outbound_headers (
      bill_id, bill_no, bill_date, bill_status, customer_id, customer_name, total_qty, total_amount,
      currency_id, updated_at, customer_code, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "bill-3",
    "XSCK-003",
    "2026-03-15",
    "C",
    "830",
    "Acme Store",
    11,
    1650,
    "CNY",
    "2026-03-15T00:00:00.000Z",
    "001.01",
    "2026-03-15T00:00:00.000Z",
    "2026-03-15T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sales_outbound_lines (
      line_id, bill_id, bill_no, bill_date, line_no, customer_id, customer_name, material_id,
      material_name, material_model, unit_name, qty, price, tax_price, all_amount, amount,
      tax_amount, is_deleted, updated_at, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    "line-1",
    "bill-1",
    "XSCK-001",
    "2026-03-01",
    1,
    "830",
    "Acme Store",
    "mat-1",
    "25kg冰宝一级珍珠米",
    "25KG",
    "袋",
    10,
    150,
    150,
    1500,
    1500,
    0,
    "2026-03-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sales_outbound_lines (
      line_id, bill_id, bill_no, bill_date, line_no, customer_id, customer_name, material_id,
      material_name, material_model, unit_name, qty, price, tax_price, all_amount, amount,
      tax_amount, is_deleted, updated_at, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    "line-2",
    "bill-2",
    "XSCK-002",
    "2026-03-08",
    1,
    "830",
    "Acme Store",
    "mat-1",
    "25kg冰宝一级珍珠米",
    "25KG",
    "袋",
    12,
    150,
    150,
    1800,
    1800,
    0,
    "2026-03-08T00:00:00.000Z",
    "2026-03-08T00:00:00.000Z",
    "2026-03-08T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sales_outbound_lines (
      line_id, bill_id, bill_no, bill_date, line_no, customer_id, customer_name, material_id,
      material_name, material_model, unit_name, qty, price, tax_price, all_amount, amount,
      tax_amount, is_deleted, updated_at, source_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    "line-3",
    "bill-3",
    "XSCK-003",
    "2026-03-15",
    1,
    "830",
    "Acme Store",
    "mat-1",
    "25kg冰宝一级珍珠米",
    "25KG",
    "袋",
    11,
    150,
    150,
    1650,
    1650,
    0,
    "2026-03-15T00:00:00.000Z",
    "2026-03-15T00:00:00.000Z",
    "2026-03-15T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO product_master_active (
      material_id, product_code, name, category, spec, unit_name, keywords_json, last_sale_date,
      sales_180d_count, avg_tax_price_180d, active_reason, source_synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "mat-1",
    "SP001",
    "25kg冰宝一级珍珠米",
    "大米",
    "25KG",
    "袋",
    JSON.stringify(["大米", "冰宝", "珍珠米"]),
    "2026-03-15",
    3,
    150,
    "recent_sales",
    "2026-03-15T00:00:00.000Z",
    "2026-03-15T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO company_contacts (
      id, company_name, customer_id, contact_name, job_title, phone, department
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("contact-1", "Acme Store", "cust-1", "张三", "采购", "13800000000", "后勤");
  db.prepare(
    `INSERT INTO customer_locations (
      id, customer_id, customer_name, location_type, location_name, address, city, district
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("loc-1", "cust-1", "Acme Store", "store", "主门店", "西安市高新区", "西安", "雁塔");
  db.prepare(
    `INSERT INTO products (
      id, full_name, display_name, category, spec, unit, avg_price, tax_code, tax_rate, frequency, brand, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "prod-1",
    "*谷物加工品*大米",
    "大米",
    "大米",
    "25KG",
    "袋",
    114.98,
    "1030102010100000000",
    "9%",
    1007,
    "冰宝",
    "active",
  );
  db.prepare(
    `INSERT INTO products (
      id, full_name, display_name, category, spec, unit, avg_price, tax_code, tax_rate, frequency, brand, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "prod-2",
    "*植物油*西瑞一级大豆油（非转基因）",
    "西瑞一级大豆油（非转基因）",
    "食用油",
    "10L*2",
    "箱",
    199.3,
    "1030105010100000000",
    "9%",
    266,
    "西瑞",
    "active",
  );

  db.close();
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CustomerDataService", () => {
  it("resolves a customer into the customer graph via kingdee_id", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const resolved = service.resolveParty({
        channel: "wecom",
        channelUserId: "peer-1",
      });
      expect(resolved).toMatchObject({
        resolution: "customer_party_via_kingdee_id",
        rootAccountId: "root-acme",
        currentPartyId: "pty-acme-store",
      });
    } finally {
      service.close();
    }
  });

  it("builds a dossier with explicit invoice links and exact-name fallback documents", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const dossier = service.getCustomerDossier({
        channel: "wecom",
        channelUserId: "peer-1",
      });
      expect(dossier.rootAccountId).toBe("root-acme");
      expect(dossier.invoices[0]).toMatchObject({
        id: "inv-1",
        linkMode: "explicit",
      });
      expect(dossier.documents[0]).toMatchObject({
        id: "doc-1",
        linkMode: "exact_name_fallback",
      });
      expect(dossier.contacts).toHaveLength(1);
      expect(dossier.locations).toHaveLength(1);
    } finally {
      service.close();
    }
  });

  it("produces ranked intent candidates from the dossier", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const intents = service.listIntentCandidates({
        channel: "wecom",
        channelUserId: "peer-1",
      });
      expect(intents[0]?.intentType).toBe("reorder");
      expect(intents.some((intent) => intent.intentType === "invoice_lookup")).toBe(true);
      expect(intents.some((intent) => intent.intentType === "contract_review")).toBe(true);
    } finally {
      service.close();
    }
  });

  it("returns safe pricing from the products catalog within customer context", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const pricing = service.getCustomerSafePricing({
        channel: "wecom",
        channelUserId: "peer-1",
        query: "大米",
        limit: 5,
      });
      expect(pricing).toMatchObject({
        resolution: "customer_party_via_kingdee_id",
        rootAccountId: "root-acme",
        pricingScope: "public_baseline",
      });
      expect(pricing.products.length).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });

  it("derives reorder demand signals from synced sales facts bridged through party refs", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const signals = service.listDemandSignals({
        channel: "wecom",
        channelUserId: "peer-1",
        limit: 5,
      });
      expect(signals[0]).toMatchObject({
        materialId: "mat-1",
        materialName: "25kg冰宝一级珍珠米",
        predictedReorderQty: 11,
        confidenceBand: "high",
      });
      expect(signals[0]?.medianGapDays).toBe(7);
    } finally {
      service.close();
    }
  });

  it("records interactions with a synthetic root when the customer is not yet in the graph", async () => {
    await createTempEnv();
    const service = CustomerDataService.open();
    try {
      const result = service.recordInteraction({
        channel: "wecom",
        channelUserId: "peer-2",
        eventType: "message_inbound",
        contentText: "帮我查下发票",
      });
      expect(result.rootAccountId).toBe("customer:cust-2");
      expect(result.resolution).toBe("customer_only");
    } finally {
      service.close();
    }
  });
});

describe("customer tools on enterprise db", () => {
  it("customer_get exposes enterprise graph context even without profile-store state", async () => {
    await createTempEnv();
    const tool = createCustomerGetTool("peer-1");
    const result = await tool.execute("call-get", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });
    expect(result.details).toMatchObject({
      found: true,
      root_account_id: "root-acme",
      current_party_id: "pty-acme-store",
      party_resolution: "customer_party_via_kingdee_id",
      artifact_summary: {
        invoices: 1,
        documents: 1,
      },
    });
    expect(result.details).toMatchObject({
      top_demand_signals: expect.arrayContaining([
        expect.objectContaining({
          material_id: "mat-1",
          predicted_reorder_qty: 11,
        }),
      ]),
    });
  });

  it("customer_get_dossier and customer_list_intent_candidates read from enterprise db", async () => {
    await createTempEnv();
    const dossierTool = createCustomerDossierTool("peer-1");
    const dossier = await dossierTool.execute("call-dossier", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });
    expect(dossier.details).toMatchObject({
      rootAccountId: "root-acme",
      artifactSummary: {
        invoices: 1,
        documents: 1,
      },
    });

    const intentTool = createCustomerIntentCandidatesTool("peer-1");
    const intents = await intentTool.execute("call-intents", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });
    expect(intents.details).toMatchObject({
      intents: expect.arrayContaining([
        expect.objectContaining({ intentType: "reorder" }),
        expect.objectContaining({ intentType: "invoice_lookup" }),
      ]),
    });
  });

  it("customer_record_interaction writes to interaction tables through the service", async () => {
    const { dbPath } = await createTempEnv();
    const tool = createCustomerRecordInteractionTool("peer-1");
    const result = await tool.execute("call-record", {
      channel: "wecom",
      channel_user_id: "peer-1",
      event_type: "message_inbound",
      content_text: "我要开票",
    });
    expect(result.details).toMatchObject({
      rootAccountId: "root-acme",
      resolution: "customer_party_via_kingdee_id",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    try {
      const threadCount = db.prepare(`SELECT COUNT(*) AS count FROM interaction_threads`).get() as {
        count: number;
      };
      const eventCount = db.prepare(`SELECT COUNT(*) AS count FROM interaction_events`).get() as {
        count: number;
      };
      expect(threadCount.count).toBe(1);
      expect(eventCount.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("customer_upsert mirrors writes into the enterprise customers table", async () => {
    const { dbPath } = await createTempEnv();
    const tool = createCustomerUpsertTool("peer-3");
    const result = await tool.execute("call-upsert", {
      channel: "wecom",
      channel_user_id: "peer-3",
      company_name: "Acme Store",
      kingdee_id: "830",
      status: "confirmed",
    });
    expect(result.details).toMatchObject({
      success: true,
      enterprise_customer_id: expect.any(String),
      root_account_id: "root-acme",
      party_resolution: "customer_party_via_kingdee_id",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT company_name, kingdee_id, channel_user_id FROM customers WHERE channel = 'wecom' AND channel_user_id = 'peer-3' LIMIT 1`,
        )
        .get() as { company_name: string; kingdee_id: string; channel_user_id: string } | undefined;
      expect(row).toMatchObject({
        company_name: "Acme Store",
        kingdee_id: "830",
        channel_user_id: "peer-3",
      });
    } finally {
      db.close();
    }
  });

  it("customer_get_safe_pricing exposes product baseline pricing through the tool surface", async () => {
    await createTempEnv();
    const tool = createCustomerSafePricingTool("peer-1");
    const result = await tool.execute("call-safe-pricing", {
      channel: "wecom",
      channel_user_id: "peer-1",
      query: "大米",
      limit: 3,
    });
    expect(result.details).toMatchObject({
      pricingScope: "public_baseline",
      products: expect.arrayContaining([
        expect.objectContaining({
          productId: "mat-1",
          priceSource: "product_master_active.avg_tax_price_180d",
        }),
      ]),
    });
  });

  it("customer_get_invoice_info includes invoice artifact context from the dossier", async () => {
    await createTempEnv();
    const tool = createCustomerInvoiceTool("peer-1");
    const result = await tool.execute("call-invoice", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });
    expect(result.details).toMatchObject({
      authorized: true,
      invoice_artifact_count: 1,
      latest_invoice_number: "FP-001",
      latest_invoice_date: "2026-04-01",
    });
  });

  it("customer_list_demand_signals exposes bridged reorder signals through the tool surface", async () => {
    await createTempEnv();
    const tool = createCustomerDemandSignalsTool("peer-1");
    const result = await tool.execute("call-demand", {
      channel: "wecom",
      channel_user_id: "peer-1",
      limit: 3,
    });
    expect(result.details).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({
          materialId: "mat-1",
          predictedReorderQty: 11,
        }),
      ]),
    });
  });
});
