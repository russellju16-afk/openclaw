import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readJsonBodyWithLimit,
  requestBodyErrorToText,
  type ClawdbotConfig,
} from "../runtime-api.js";
import { resolveFeishuRuntimeAccount } from "./accounts.js";
import { createFeishuClient, type FeishuClientCredentials } from "./client.js";

export const FEISHU_PLUS_MENU_HTTP_PREFIX = "/plugins/feishu/plus";
export const FEISHU_PLUS_MENU_H5_SDK_URL =
  "https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.30.js";

const FEISHU_PLUS_MENU_JSAPI_LIST = ["getTriggerContext", "sendMessageCard"] as const;
const FEISHU_PLUS_MENU_TICKET_SKEW_MS = 60_000;

type PluginLoggerLike = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

type JsapiTicketResponse = {
  code?: number;
  msg?: string;
  data?: {
    ticket?: string;
    expire_in?: number;
  };
};

type JsapiTicketCacheEntry = {
  ticket: string;
  expiresAt: number;
};

type FeishuRequestClient = ReturnType<typeof createFeishuClient> & {
  request(params: {
    method: "POST";
    url: string;
    data: Record<string, never>;
    timeout?: number;
  }): Promise<JsapiTicketResponse>;
};

type FeishuPlusMenuRoute =
  | {
      kind: "page";
      accountId: string;
      pagePath: string;
      sdkConfigPath: string;
    }
  | {
      kind: "sdk-config";
      accountId: string;
      pagePath: string;
      sdkConfigPath: string;
    };

export type FeishuPlusMenuHttpHandlerOptions = {
  loadConfig: () => ClawdbotConfig;
  logger?: PluginLoggerLike;
  createClient?: (creds: FeishuClientCredentials) => FeishuRequestClient;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  h5SdkUrl?: string;
};

const jsapiTicketCache = new Map<string, JsapiTicketCacheEntry>();
const jsapiTicketInFlight = new Map<string, Promise<JsapiTicketCacheEntry>>();

export function clearFeishuPlusMenuTicketCacheForTests(): void {
  jsapiTicketCache.clear();
  jsapiTicketInFlight.clear();
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeForwardedHeaderValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

function resolveExpectedRequestHost(req: IncomingMessage): string | null {
  const forwardedHost = normalizeForwardedHeaderValue(
    firstHeaderValue(req.headers["x-forwarded-host"]),
  );
  const host = forwardedHost ?? normalizeForwardedHeaderValue(firstHeaderValue(req.headers.host));
  return host ?? null;
}

function resolveExpectedRequestProtocol(req: IncomingMessage): "http" | "https" | null {
  const forwardedProto = normalizeForwardedHeaderValue(
    firstHeaderValue(req.headers["x-forwarded-proto"]),
  );
  if (forwardedProto === "http" || forwardedProto === "https") {
    return forwardedProto;
  }

  if ("encrypted" in req.socket && req.socket.encrypted) {
    return "https";
  }

  const host = resolveExpectedRequestHost(req);
  if (host?.startsWith("localhost") || host?.startsWith("127.0.0.1")) {
    return "http";
  }

  return null;
}

function parsePlusMenuRoute(pathname: string): FeishuPlusMenuRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "plugins" || parts[1] !== "feishu" || parts[2] !== "plus") {
    return null;
  }

  const accountId = parts[3]?.trim();
  if (!accountId || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(accountId)) {
    return null;
  }

  const pagePath = `${FEISHU_PLUS_MENU_HTTP_PREFIX}/${accountId}`;
  const sdkConfigPath = `${pagePath}/sdk-config`;
  if (parts.length === 4) {
    return { kind: "page", accountId, pagePath, sdkConfigPath };
  }
  if (parts.length === 5 && parts[4] === "sdk-config") {
    return { kind: "sdk-config", accountId, pagePath, sdkConfigPath };
  }
  return null;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(body);
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(body);
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildJsapiVerifyString(params: {
  ticket: string;
  nonceStr: string;
  timestamp: number;
  url: string;
}): string {
  return `jsapi_ticket=${params.ticket}&noncestr=${params.nonceStr}&timestamp=${params.timestamp}&url=${params.url}`;
}

function signJsapiVerifyString(verifyString: string): string {
  return createHash("sha1").update(verifyString).digest("hex");
}

function resolvePlusMenuPageUrl(params: {
  pageUrl: string;
  expectedHost: string | null;
  expectedProtocol: "http" | "https" | null;
  expectedPagePath: string;
}): string | null {
  try {
    const parsed = new URL(params.pageUrl);
    const normalizedUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    if (parsed.pathname !== params.expectedPagePath) {
      return null;
    }
    if (params.expectedHost && parsed.host !== params.expectedHost) {
      return null;
    }
    if (params.expectedProtocol && parsed.protocol.replace(/:$/, "") !== params.expectedProtocol) {
      return null;
    }
    return normalizedUrl;
  } catch {
    return null;
  }
}

async function getJsapiTicket(params: {
  creds: FeishuClientCredentials;
  createClient: (creds: FeishuClientCredentials) => FeishuRequestClient;
  now: number;
}): Promise<JsapiTicketCacheEntry> {
  const cacheKey =
    params.creds.accountId ?? `${params.creds.appId}:${params.creds.appSecret?.slice(0, 8)}`;
  const cached = jsapiTicketCache.get(cacheKey);
  if (cached && cached.expiresAt > params.now) {
    return cached;
  }

  const existing = jsapiTicketInFlight.get(cacheKey);
  if (existing) {
    return await existing;
  }

  const request = (async () => {
    const client = params.createClient(params.creds);
    const response = await client.request({
      method: "POST",
      url: "/open-apis/jssdk/ticket/get",
      data: {},
    });
    if (response.code !== 0 || !response.data?.ticket) {
      throw new Error(
        response.msg || `Failed to fetch jsapi_ticket (code ${response.code ?? "unknown"})`,
      );
    }
    const expireInMs = Math.max(1_000, (response.data.expire_in ?? 7200) * 1000);
    const entry = {
      ticket: response.data.ticket,
      expiresAt: params.now + Math.max(1_000, expireInMs - FEISHU_PLUS_MENU_TICKET_SKEW_MS),
    };
    jsapiTicketCache.set(cacheKey, entry);
    return entry;
  })();

  jsapiTicketInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    jsapiTicketInFlight.delete(cacheKey);
  }
}

function renderPlusMenuPage(params: {
  appId: string;
  appLabel: string;
  accountId: string;
  pagePath: string;
  sdkConfigPath: string;
  h5SdkUrl: string;
}): string {
  const bootstrapJson = serializeJsonForHtml({
    appId: params.appId,
    appLabel: params.appLabel,
    accountId: params.accountId,
    pagePath: params.pagePath,
    sdkConfigPath: params.sdkConfigPath,
    h5SdkUrl: params.h5SdkUrl,
    promptMaxChars: 1500,
    promptPreviewChars: 360,
    actionTtlMs: 10 * 60_000,
  });

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>${params.appLabel} · Feishu Plus Menu</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7fb;
        --panel: rgba(255, 255, 255, 0.92);
        --panel-border: rgba(15, 23, 42, 0.08);
        --text: #10233f;
        --muted: #5f708d;
        --accent: #1463ff;
        --accent-soft: rgba(20, 99, 255, 0.10);
        --success: #177245;
        --danger: #bb2236;
        --shadow: 0 18px 48px rgba(17, 35, 63, 0.12);
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(20, 99, 255, 0.12), transparent 32%),
          linear-gradient(180deg, #f8fbff 0%, var(--bg) 58%, #eef3f8 100%);
        color: var(--text);
      }

      .shell {
        min-height: 100vh;
        padding: 20px 16px 28px;
        display: flex;
        justify-content: center;
      }

      .panel {
        width: min(760px, 100%);
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
        padding: 22px 22px 20px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      h1 {
        margin: 16px 0 8px;
        font-size: clamp(24px, 5vw, 34px);
        line-height: 1.06;
      }

      .lede {
        margin: 0 0 18px;
        color: var(--muted);
        line-height: 1.55;
      }

      .status {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 18px;
      }

      .metric {
        border-radius: 18px;
        border: 1px solid rgba(15, 23, 42, 0.06);
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.8);
      }

      .metric__label {
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 6px;
      }

      .metric__value {
        font-size: 14px;
        font-weight: 600;
        word-break: break-word;
      }

      form { display: grid; gap: 14px; }

      label {
        display: grid;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
      }

      textarea {
        width: 100%;
        min-height: 168px;
        resize: vertical;
        border-radius: 18px;
        border: 1px solid rgba(20, 99, 255, 0.18);
        background: rgba(255, 255, 255, 0.96);
        padding: 14px 16px;
        font: inherit;
        line-height: 1.5;
        color: var(--text);
        outline: none;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }

      textarea:focus {
        border-color: rgba(20, 99, 255, 0.48);
        box-shadow: 0 0 0 4px rgba(20, 99, 255, 0.12);
      }

      .field-meta,
      .hint,
      .result {
        font-size: 13px;
        line-height: 1.5;
        color: var(--muted);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        appearance: none;
        border: 0;
        background: rgba(16, 35, 63, 0.06);
        color: var(--text);
        border-radius: 999px;
        padding: 8px 12px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }

      .chat-type {
        display: none;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.74);
        border: 1px dashed rgba(16, 35, 63, 0.16);
      }

      .chat-type[data-visible="true"] {
        display: grid;
      }

      .chat-type__options {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }

      .chat-type__choice {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(20, 99, 255, 0.08);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .button--primary {
        background: linear-gradient(135deg, #1463ff 0%, #1f8bff 100%);
        color: white;
        box-shadow: 0 12px 24px rgba(20, 99, 255, 0.22);
      }

      .button--ghost {
        background: rgba(16, 35, 63, 0.06);
        color: var(--text);
      }

      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.55;
        box-shadow: none;
      }

      .result[data-tone="error"] { color: var(--danger); }
      .result[data-tone="success"] { color: var(--success); }

      @media (max-width: 640px) {
        .panel {
          border-radius: 20px;
          padding: 18px 16px;
        }
      }
    </style>
    <script>
      window.__OPENCLAW_FEISHU_PLUS__ = ${bootstrapJson};
    </script>
    <script src="${params.h5SdkUrl}"></script>
  </head>
  <body>
    <main class="shell">
      <section class="panel">
        <div class="eyebrow">Feishu Plus Menu</div>
        <h1>${params.appLabel}</h1>
        <p class="lede">在当前会话里起一个 OpenClaw 提示卡。发送成功后，回到聊天区点一下卡片按钮就会运行。</p>

        <section class="status">
          <div class="metric">
            <div class="metric__label">SDK 状态</div>
            <div class="metric__value" id="sdk-status">初始化中</div>
          </div>
          <div class="metric">
            <div class="metric__label">当前会话</div>
            <div class="metric__value" id="chat-status">等待识别</div>
          </div>
          <div class="metric">
            <div class="metric__label">触发码</div>
            <div class="metric__value" id="trigger-status">等待识别</div>
          </div>
        </section>

        <form id="prompt-form">
          <label>
            要让 ${params.appLabel} 做什么？
            <textarea id="prompt-input" maxlength="1500" placeholder="例如：总结最近 20 条消息，并起草一个礼貌但明确的回复。"></textarea>
          </label>
          <div class="field-meta" id="prompt-counter">0 / 1500</div>

          <div class="chips" id="prompt-suggestions">
            <button class="chip" type="button" data-prompt="总结当前会话最近的关键点，并列出待办事项。">总结当前会话</button>
            <button class="chip" type="button" data-prompt="基于当前会话上下文，起草一条可以直接发送的回复。">起草回复</button>
            <button class="chip" type="button" data-prompt="从当前会话里抽取行动项、负责人和时间点。">抽取行动项</button>
            <button class="chip" type="button" data-prompt="用更简洁、更专业的语气重写当前讨论里的核心结论。">重写核心结论</button>
          </div>

          <section class="chat-type" id="chat-type-panel" data-visible="false">
            <div class="hint">当前会话类型无法自动识别，请手动选择。</div>
            <div class="chat-type__options">
              <label class="chat-type__choice"><input type="radio" name="chatType" value="p2p" /> 私聊</label>
              <label class="chat-type__choice"><input type="radio" name="chatType" value="group" /> 群聊</label>
            </div>
          </section>

          <div class="hint" id="context-hint">只有从聊天框 “+” 打开的页面，才能把卡片发回当前会话。</div>

          <div class="actions">
            <button class="button button--primary" type="submit" id="send-button" disabled>发送到当前会话</button>
            <button class="button button--ghost" type="button" id="clear-button">清空</button>
          </div>

          <div class="result" id="result" data-tone="muted"></div>
        </form>
      </section>
    </main>

    <script>
      (() => {
        const boot = window.__OPENCLAW_FEISHU_PLUS__;
        const state = {
          triggerCode: null,
          openChatId: null,
          chatType: null,
          ready: false,
        };

        const promptInput = document.getElementById("prompt-input");
        const promptCounter = document.getElementById("prompt-counter");
        const sdkStatus = document.getElementById("sdk-status");
        const chatStatus = document.getElementById("chat-status");
        const triggerStatus = document.getElementById("trigger-status");
        const result = document.getElementById("result");
        const sendButton = document.getElementById("send-button");
        const clearButton = document.getElementById("clear-button");
        const promptForm = document.getElementById("prompt-form");
        const chatTypePanel = document.getElementById("chat-type-panel");

        function setResult(message, tone = "muted") {
          result.textContent = message;
          result.dataset.tone = tone;
        }

        function updatePromptCounter() {
          promptCounter.textContent = promptInput.value.length + " / " + boot.promptMaxChars;
        }

        function clipPromptPreview(prompt) {
          return prompt.length > boot.promptPreviewChars
            ? prompt.slice(0, boot.promptPreviewChars - 1) + "…"
            : prompt;
        }

        function readSelectedChatType() {
          if (state.chatType) {
            return state.chatType;
          }
          const selected = document.querySelector('input[name="chatType"]:checked');
          return selected ? selected.value : null;
        }

        function syncButtonState() {
          sendButton.disabled = !state.ready || !promptInput.value.trim();
        }

        function setUnknownChatType() {
          chatTypePanel.dataset.visible = "true";
          state.chatType = null;
          chatStatus.textContent = "需要手动选择";
        }

        function inferChatType(rawValues) {
          const candidates = rawValues
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());
          for (const value of candidates) {
            if (value.includes("p2p") || value.includes("direct")) {
              return "p2p";
            }
            if (value.includes("group") || value.includes("chat")) {
              return "group";
            }
          }
          return null;
        }

        function parseLaunchQuery() {
          const raw = new URLSearchParams(window.location.search).get("bdp_launch_query");
          if (!raw) {
            return null;
          }
          for (const candidate of [raw, decodeURIComponent(raw)]) {
            try {
              return JSON.parse(candidate);
            } catch {}
          }
          return null;
        }

        function buildPromptCard(prompt, openChatId, chatType) {
          return {
            msg_type: "interactive",
            update_multi: false,
            card: {
              schema: "2.0",
              config: { wide_screen_mode: true },
              header: {
                title: {
                  tag: "plain_text",
                  content: boot.appLabel,
                },
                template: "indigo",
              },
              body: {
                elements: [
                  {
                    tag: "div",
                    text: {
                      tag: "plain_text",
                      content: clipPromptPreview(prompt),
                    },
                  },
                  {
                    tag: "markdown",
                    content: "点下面按钮，把这个提示交给 OpenClaw 运行。",
                  },
                  {
                    tag: "action",
                    actions: [
                      {
                        tag: "button",
                        type: "primary",
                        text: {
                          tag: "plain_text",
                          content: "运行",
                        },
                        value: {
                          oc: "ocf1",
                          k: "quick",
                          a: "feishu.plus_menu.run",
                          q: prompt,
                          c: {
                            h: openChatId,
                            e: Date.now() + boot.actionTtlMs,
                            ...(chatType ? { t: chatType } : {}),
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          };
        }

        async function fetchSdkConfig(pageUrl) {
          const response = await fetch(boot.sdkConfigPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: pageUrl }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || "获取 JS SDK 鉴权参数失败");
          }
          return payload;
        }

        async function configureSdk() {
          if (!window.h5sdk || !window.tt) {
            throw new Error("当前页面不在飞书网页容器内，无法使用 H5 JS SDK。");
          }
          const pageUrl = window.location.origin + window.location.pathname + window.location.search;
          const params = await fetchSdkConfig(pageUrl);

          await new Promise((resolve, reject) => {
            window.h5sdk.ready(resolve);
            window.h5sdk.error((err) => {
              reject(new Error(err && err.errorMessage ? err.errorMessage : "H5 JS SDK 鉴权失败"));
            });
            window.h5sdk.config({
              appId: params.appId,
              timestamp: Number(params.timestamp),
              nonceStr: params.nonceStr,
              signature: params.signature,
              jsApiList: params.jsApiList,
            });
          });
        }

        async function resolveConversationContext() {
          const search = new URLSearchParams(window.location.search);
          const launchQuery = parseLaunchQuery();
          const triggerCode =
            launchQuery && typeof launchQuery.__trigger_id__ === "string"
              ? launchQuery.__trigger_id__
              : launchQuery && typeof launchQuery.trigger_id === "string"
                ? launchQuery.trigger_id
                : null;

          if (!triggerCode) {
            throw new Error("没有识别到 triggerCode，请从聊天框“+”菜单重新打开。");
          }

          state.triggerCode = triggerCode;
          triggerStatus.textContent = triggerCode;

          const context = await new Promise((resolve, reject) => {
            window.tt.getTriggerContext({
              triggerCode,
              success: resolve,
              fail: (err) => reject(new Error(err && err.errMsg ? err.errMsg : "获取会话上下文失败")),
            });
          });

          state.openChatId = context && context.openChatId ? String(context.openChatId) : null;
          if (!state.openChatId) {
            throw new Error("没有拿到当前会话的 openChatId。");
          }

          const inferredChatType = inferChatType([
            search.get("from"),
            search.get("required_launch_ability"),
            context && context.bizType,
            launchQuery && launchQuery.bizType,
            launchQuery && launchQuery.__biz_type__,
          ]);

          if (inferredChatType) {
            state.chatType = inferredChatType;
            chatTypePanel.dataset.visible = "false";
          } else {
            setUnknownChatType();
          }

          chatStatus.textContent =
            state.openChatId + (state.chatType ? " · " + (state.chatType === "p2p" ? "私聊" : "群聊") : "");
        }

        async function handleSubmit(event) {
          event.preventDefault();
          if (!state.ready) {
            setResult("JS SDK 还没准备好。", "error");
            return;
          }
          const prompt = promptInput.value.trim();
          if (!prompt) {
            setResult("先写一点要交给 OpenClaw 的内容。", "error");
            return;
          }
          if (!state.openChatId || !state.triggerCode) {
            setResult("当前页面没有关联到会话，请从聊天框“+”菜单重新打开。", "error");
            return;
          }
          const chatType = readSelectedChatType();
          if (!chatType) {
            setResult("请选择当前会话类型。", "error");
            return;
          }

          sendButton.disabled = true;
          setResult("正在发送卡片…");

          try {
            const cardContent = buildPromptCard(prompt, state.openChatId, chatType);
            await new Promise((resolve, reject) => {
              window.tt.sendMessageCard({
                triggerCode: state.triggerCode,
                cardContent,
                success: resolve,
                fail: (err) => reject(new Error(err && err.errMsg ? err.errMsg : "发送卡片失败")),
              });
            });
            setResult("卡片已发回当前会话。回到聊天区点一下“运行”按钮即可。", "success");
          } catch (error) {
            setResult(error instanceof Error ? error.message : String(error), "error");
          } finally {
            syncButtonState();
          }
        }

        document.querySelectorAll("[data-prompt]").forEach((button) => {
          button.addEventListener("click", () => {
            promptInput.value = button.dataset.prompt || "";
            updatePromptCounter();
            syncButtonState();
            promptInput.focus();
          });
        });

        promptInput.addEventListener("input", () => {
          updatePromptCounter();
          syncButtonState();
        });

        clearButton.addEventListener("click", () => {
          promptInput.value = "";
          setResult("");
          updatePromptCounter();
          syncButtonState();
          promptInput.focus();
        });

        promptForm.addEventListener("submit", handleSubmit);

        updatePromptCounter();

        (async () => {
          try {
            sdkStatus.textContent = "鉴权中";
            await configureSdk();
            sdkStatus.textContent = "已就绪";
            await resolveConversationContext();
            state.ready = true;
            syncButtonState();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sdkStatus.textContent = "不可用";
            chatStatus.textContent = "未识别";
            triggerStatus.textContent = "未识别";
            setResult(message, "error");
          }
        })();
      })();
    </script>
  </body>
</html>`;
}

export function createFeishuPlusMenuHttpHandler(
  options: FeishuPlusMenuHttpHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const createClient =
    options.createClient ?? ((creds) => createFeishuClient(creds) as FeishuRequestClient);
  const now = options.now ?? Date.now;
  const randomHex = options.randomHex ?? ((bytes: number) => randomBytes(bytes).toString("hex"));
  const h5SdkUrl = options.h5SdkUrl ?? FEISHU_PLUS_MENU_H5_SDK_URL;

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = parsePlusMenuRoute(url.pathname);
    if (!route) {
      return false;
    }

    const cfg = options.loadConfig();
    let account;
    try {
      account = resolveFeishuRuntimeAccount({ cfg, accountId: route.accountId });
    } catch (error) {
      sendText(res, 503, error instanceof Error ? error.message : String(error));
      return true;
    }

    if (!account.enabled || !account.configured || !account.appId || !account.appSecret) {
      sendText(res, 503, `Feishu account "${route.accountId}" is not enabled or configured.`);
      return true;
    }

    if (route.kind === "page") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("allow", "GET, HEAD");
        sendText(res, 405, "Method Not Allowed");
        return true;
      }
      const appLabel = account.name?.trim() || "OpenClaw";
      const html = renderPlusMenuPage({
        appId: account.appId,
        appLabel,
        accountId: route.accountId,
        pagePath: route.pagePath,
        sdkConfigPath: route.sdkConfigPath,
        h5SdkUrl,
      });
      if (req.method === "HEAD") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("cache-control", "no-store, max-age=0");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("referrer-policy", "no-referrer");
        res.end();
        return true;
      }
      sendHtml(res, 200, html);
      return true;
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      sendText(res, 405, "Method Not Allowed");
      return true;
    }

    const body = await readJsonBodyWithLimit(req, {
      maxBytes: 32 * 1024,
      timeoutMs: 15_000,
      emptyObjectOnEmpty: false,
    });
    if (!body.ok) {
      const statusCode =
        body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
      const errorText =
        body.code === "INVALID_JSON"
          ? body.error || "Invalid JSON body."
          : requestBodyErrorToText(body.code);
      sendJson(res, statusCode, { error: errorText });
      return true;
    }

    const pageUrl =
      body.value && typeof body.value === "object" && "url" in body.value
        ? (body.value as { url?: unknown }).url
        : undefined;
    if (typeof pageUrl !== "string" || !pageUrl.trim()) {
      sendJson(res, 400, { error: "Missing page url." });
      return true;
    }

    const normalizedPageUrl = resolvePlusMenuPageUrl({
      pageUrl: pageUrl.trim(),
      expectedHost: resolveExpectedRequestHost(req),
      expectedProtocol: resolveExpectedRequestProtocol(req),
      expectedPagePath: route.pagePath,
    });
    if (!normalizedPageUrl) {
      sendJson(res, 400, { error: "Page url does not match the current Feishu plus-menu page." });
      return true;
    }

    try {
      const issuedAt = now();
      const nonceStr = randomHex(12);
      const ticket = await getJsapiTicket({
        creds: account,
        createClient,
        now: issuedAt,
      });
      const signature = signJsapiVerifyString(
        buildJsapiVerifyString({
          ticket: ticket.ticket,
          nonceStr,
          timestamp: issuedAt,
          url: normalizedPageUrl,
        }),
      );

      sendJson(res, 200, {
        appId: account.appId,
        timestamp: issuedAt,
        nonceStr,
        signature,
        jsApiList: [...FEISHU_PLUS_MENU_JSAPI_LIST],
      });
      return true;
    } catch (error) {
      options.logger?.warn?.(
        `feishu[${route.accountId}]: failed to build plus-menu sdk config: ${String(error)}`,
      );
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  };
}
