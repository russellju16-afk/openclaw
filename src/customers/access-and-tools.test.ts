import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeCustomerAccess } from "./authorize-access.js";
import { CustomerProfileStore } from "./profile-store.js";
import { createCustomerGetTool } from "./tools/customer-get-tool.js";
import { createCustomerInvoiceTool } from "./tools/customer-invoice-tool.js";
import { createCustomerUpsertTool } from "./tools/customer-upsert-tool.js";

const tempDirs: string[] = [];

async function createStateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-customers-test-"));
  tempDirs.push(dir);
  vi.stubEnv("OPENCLAW_STATE_DIR", dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("authorizeCustomerAccess", () => {
  it("downgrades explicit scopes for unconfirmed contacts", () => {
    const auth = authorizeCustomerAccess("staff", false, ["company_finance"]);

    expect(auth.scopes).toEqual(["public"]);
    expect(auth.canQueryAR).toBe(false);
    expect(auth.canViewInvoiceInfo).toBe(false);
  });
});

describe("customer tools", () => {
  it("does not return a profile from another channel", async () => {
    await createStateDir();
    const store = CustomerProfileStore.open();
    store.upsert({
      id: "peer-1",
      agentId: "agent-feishu",
      channelType: "feishu",
      channelPeerId: "peer-1",
      name: "Alice",
      companyName: "Acme",
      dataTier: "boss",
      tierConfirmed: true,
    });
    store.close();

    const getTool = createCustomerGetTool("peer-1");
    const getResult = await getTool.execute("call-get", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });

    expect(getResult.details).toMatchObject({
      found: false,
      channel: "wecom",
      channel_user_id: "peer-1",
    });

    const invoiceTool = createCustomerInvoiceTool("peer-1");
    const invoiceResult = await invoiceTool.execute("call-invoice", {
      channel: "wecom",
      channel_user_id: "peer-1",
    });

    expect(invoiceResult.details).toMatchObject({
      found: false,
      channel: "wecom",
      channel_user_id: "peer-1",
    });
  });

  it("rejects cross-channel upserts for an existing peer id", async () => {
    await createStateDir();
    const store = CustomerProfileStore.open();
    store.upsert({
      id: "peer-1",
      agentId: "agent-feishu",
      channelType: "feishu",
      channelPeerId: "peer-1",
      name: "Alice",
    });
    store.close();

    const upsertTool = createCustomerUpsertTool("peer-1");

    await expect(
      upsertTool.execute("call-upsert", {
        channel: "wecom",
        channel_user_id: "peer-1",
        company_name: "Acme",
      }),
    ).rejects.toThrow("already exists for channel");
  });
});

describe("CustomerProfileStore.open", () => {
  it("creates parent directories for custom database paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openclaw-customer-db-test-"));
    tempDirs.push(root);
    const dbPath = path.join(root, "nested", "profiles.sqlite");

    const store = CustomerProfileStore.open(dbPath);
    store.close();

    expect(existsSync(dbPath)).toBe(true);
  });
});
