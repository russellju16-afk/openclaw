import { createHash } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawdbotConfig } from "../runtime-api.js";
import {
  clearFeishuPlusMenuTicketCacheForTests,
  createFeishuPlusMenuHttpHandler,
  FEISHU_PLUS_MENU_HTTP_PREFIX,
} from "./plus-menu-http.js";

function createMockRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", {
    value: "127.0.0.1",
    configurable: true,
  });
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers = { host: "gateway.example.com", ...headers };

  process.nextTick(() => {
    if (body !== undefined) {
      const raw =
        typeof body === "string"
          ? body
          : Buffer.from(JSON.stringify(body), "utf-8").toString("utf-8");
      req.emit("data", Buffer.from(raw));
    }
    req.emit("end");
  });

  return req;
}

function createMockResponse(): ServerResponse & {
  _getData: () => string;
  _getStatusCode: () => number;
} {
  const res = new ServerResponse({} as IncomingMessage);
  let data = "";
  let statusCode = 200;

  res.write = function (chunk: unknown) {
    data += String(chunk);
    return true;
  };

  res.end = function (chunk?: unknown) {
    if (chunk !== undefined) {
      data += String(chunk);
    }
    return this;
  };

  Object.defineProperty(res, "statusCode", {
    get: () => statusCode,
    set: (value: number) => {
      statusCode = value;
    },
  });

  (res as unknown as { _getData: () => string })._getData = () => data;
  (res as unknown as { _getStatusCode: () => number })._getStatusCode = () => statusCode;

  return res;
}

function createConfig(): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        enabled: true,
        accounts: {
          default: {
            appId: "cli_test_app",
            appSecret: "test-secret",
            name: "QA Agent",
          },
        },
      },
    },
  } as ClawdbotConfig;
}

describe("feishu plus-menu http handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFeishuPlusMenuTicketCacheForTests();
  });

  it("returns false for unrelated paths", async () => {
    const handler = createFeishuPlusMenuHttpHandler({
      loadConfig: createConfig,
    });

    const handled = await handler(createMockRequest("GET", "/not-feishu"), createMockResponse());
    expect(handled).toBe(false);
  });

  it("serves the plus-menu page for a configured account", async () => {
    const handler = createFeishuPlusMenuHttpHandler({
      loadConfig: createConfig,
    });

    const res = createMockResponse();
    const handled = await handler(
      createMockRequest("GET", `${FEISHU_PLUS_MENU_HTTP_PREFIX}/default`),
      res,
    );

    expect(handled).toBe(true);
    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader("content-type")).toBe("text/html; charset=utf-8");
    expect(res._getData()).toContain("QA Agent");
    expect(res._getData()).toContain(`${FEISHU_PLUS_MENU_HTTP_PREFIX}/default/sdk-config`);
    expect(res._getData()).toContain("triggerCode");
  });

  it("builds a JS SDK signature for the current page url", async () => {
    const clientRequest = vi.fn(async () => ({
      code: 0,
      data: {
        ticket: "ticket-123",
        expire_in: 7200,
      },
    }));
    const handler = createFeishuPlusMenuHttpHandler({
      loadConfig: createConfig,
      now: () => 1_700_000_000_000,
      randomHex: () => "nonce-value",
      createClient: () =>
        ({
          request: clientRequest,
        }) as never,
    });

    const pageUrl = "https://gateway.example.com/plugins/feishu/plus/default?from=plus_menu_p2p";
    const res = createMockResponse();
    const handled = await handler(
      createMockRequest(
        "POST",
        `${FEISHU_PLUS_MENU_HTTP_PREFIX}/default/sdk-config`,
        { url: pageUrl },
        { "x-forwarded-proto": "https", "x-forwarded-host": "gateway.example.com" },
      ),
      res,
    );

    expect(handled).toBe(true);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData()) as {
      appId: string;
      timestamp: number;
      nonceStr: string;
      signature: string;
      jsApiList: string[];
    };
    expect(payload.appId).toBe("cli_test_app");
    expect(payload.timestamp).toBe(1_700_000_000_000);
    expect(payload.nonceStr).toBe("nonce-value");
    expect(payload.jsApiList).toEqual(["getTriggerContext", "sendMessageCard"]);
    expect(payload.signature).toBe(
      createHash("sha1")
        .update(
          "jsapi_ticket=ticket-123&noncestr=nonce-value&timestamp=1700000000000&url=" + pageUrl,
        )
        .digest("hex"),
    );
    expect(clientRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects sdk-config requests for mismatched page origins", async () => {
    const handler = createFeishuPlusMenuHttpHandler({
      loadConfig: createConfig,
      createClient: () =>
        ({
          request: vi.fn(),
        }) as never,
    });

    const res = createMockResponse();
    await handler(
      createMockRequest(
        "POST",
        `${FEISHU_PLUS_MENU_HTTP_PREFIX}/default/sdk-config`,
        { url: "https://evil.example.com/plugins/feishu/plus/default" },
        { "x-forwarded-proto": "https", "x-forwarded-host": "gateway.example.com" },
      ),
      res,
    );

    expect(res._getStatusCode()).toBe(400);
    expect(res._getData()).toContain("does not match");
  });
});
