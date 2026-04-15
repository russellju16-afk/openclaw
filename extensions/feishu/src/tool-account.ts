import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "../runtime-api.js";
import {
  listFeishuAccountIds,
  resolveFeishuAccount,
  resolveFeishuRuntimeAccount,
} from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { resolveToolsConfig } from "./tools-config.js";
import type { FeishuToolsConfig, ResolvedFeishuAccount } from "./types.js";

type AccountAwareParams = { accountId?: string };

type ToolAccountApi = Pick<OpenClawPluginApi, "config" | "runtime">;

function normalizeOptionalAccountId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveLiveConfig(api: ToolAccountApi): OpenClawPluginApi["config"] {
  // Read live config so writeConfigFile updates take effect without restart.
  return api.runtime?.config?.loadConfig?.() ?? api.config;
}

function readConfiguredDefaultAccountId(config: OpenClawPluginApi["config"]): string | undefined {
  const value = (config?.channels?.feishu as { defaultAccount?: unknown } | undefined)
    ?.defaultAccount;
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeOptionalAccountId(value);
}

function resolveImplicitToolAccountId(params: {
  api: ToolAccountApi;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
}): string | undefined {
  const explicitAccountId = normalizeOptionalAccountId(params.executeParams?.accountId);
  if (explicitAccountId) {
    return explicitAccountId;
  }

  const liveConfig = resolveLiveConfig(params.api);

  const configuredDefaultAccountId = readConfiguredDefaultAccountId(liveConfig);
  if (configuredDefaultAccountId) {
    return configuredDefaultAccountId;
  }

  const contextualAccountId = normalizeOptionalAccountId(params.defaultAccountId);
  if (!contextualAccountId) {
    return undefined;
  }

  if (!listFeishuAccountIds(liveConfig).includes(contextualAccountId)) {
    return undefined;
  }

  const contextualAccount = resolveFeishuAccount({
    cfg: liveConfig,
    accountId: contextualAccountId,
  });
  return contextualAccount.enabled ? contextualAccountId : undefined;
}

export function resolveFeishuToolAccount(params: {
  api: ToolAccountApi;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
}): ResolvedFeishuAccount {
  const liveConfig = resolveLiveConfig(params.api);
  if (!liveConfig) {
    throw new Error("Feishu config unavailable");
  }
  return resolveFeishuRuntimeAccount({
    cfg: liveConfig,
    accountId: resolveImplicitToolAccountId(params),
  });
}

export function createFeishuToolClient(params: {
  api: ToolAccountApi;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
}): Lark.Client {
  return createFeishuClient(resolveFeishuToolAccount(params));
}

export function resolveAnyEnabledFeishuToolsConfig(
  accounts: ResolvedFeishuAccount[],
): Required<FeishuToolsConfig> {
  const merged: Required<FeishuToolsConfig> = {
    doc: false,
    chat: false,
    wiki: false,
    drive: false,
    perm: false,
    scopes: false,
  };
  for (const account of accounts) {
    const cfg = resolveToolsConfig(account.config.tools);
    merged.doc = merged.doc || cfg.doc;
    merged.chat = merged.chat || cfg.chat;
    merged.wiki = merged.wiki || cfg.wiki;
    merged.drive = merged.drive || cfg.drive;
    merged.perm = merged.perm || cfg.perm;
    merged.scopes = merged.scopes || cfg.scopes;
  }
  return merged;
}
