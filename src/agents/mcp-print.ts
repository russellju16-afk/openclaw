import { formatExecCommand } from "../infra/system-run-command.js";
import { isMcpConfigRecord } from "./mcp-config-shared.js";
import { resolveHttpMcpServerLaunchConfig, type HttpMcpTransportType } from "./mcp-http.js";
import { resolveStdioMcpServerLaunchConfig } from "./mcp-stdio.js";

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export type InspectedConfiguredMcpServer =
  | {
      name: string;
      status: "ok";
      transportType: "stdio" | HttpMcpTransportType;
      connectionTimeoutMs: number;
      target: string;
      cwd?: string;
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    }
  | {
      name: string;
      status: "invalid";
      reason: string;
    };

function getConnectionTimeoutMs(rawServer: unknown): number {
  if (
    rawServer &&
    typeof rawServer === "object" &&
    typeof (rawServer as { connectionTimeoutMs?: unknown }).connectionTimeoutMs === "number" &&
    (rawServer as { connectionTimeoutMs: number }).connectionTimeoutMs > 0
  ) {
    return (rawServer as { connectionTimeoutMs: number }).connectionTimeoutMs;
  }
  return DEFAULT_CONNECTION_TIMEOUT_MS;
}

function getRequestedTransport(rawServer: unknown): string {
  if (
    !rawServer ||
    typeof rawServer !== "object" ||
    typeof (rawServer as { transport?: unknown }).transport !== "string"
  ) {
    return "";
  }
  return ((rawServer as { transport?: string }).transport ?? "").trim().toLowerCase();
}

function formatSingleToken(value: string): string {
  return formatExecCommand([value]);
}

function formatKeyValuePairs(value: Record<string, string>): string {
  return Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => formatSingleToken(`${key}=${entry}`))
    .join(" ");
}

export function inspectConfiguredMcpServer(
  name: string,
  rawServer: unknown,
): InspectedConfiguredMcpServer {
  const connectionTimeoutMs = getConnectionTimeoutMs(rawServer);
  const stdioLaunch = resolveStdioMcpServerLaunchConfig(rawServer);
  if (stdioLaunch.ok) {
    return {
      name,
      status: "ok",
      transportType: "stdio",
      connectionTimeoutMs,
      target: formatExecCommand([stdioLaunch.config.command, ...(stdioLaunch.config.args ?? [])]),
      cwd: stdioLaunch.config.cwd,
      env: stdioLaunch.config.env,
    };
  }

  const requestedTransport = getRequestedTransport(rawServer);
  if (
    requestedTransport &&
    requestedTransport !== "sse" &&
    requestedTransport !== "streamable-http"
  ) {
    return {
      name,
      status: "invalid",
      reason: `transport "${requestedTransport}" is not supported`,
    };
  }

  if (requestedTransport === "streamable-http") {
    const streamableLaunch = resolveHttpMcpServerLaunchConfig(rawServer, {
      transportType: "streamable-http",
    });
    if (streamableLaunch.ok) {
      return {
        name,
        status: "ok",
        transportType: "streamable-http",
        connectionTimeoutMs,
        target: streamableLaunch.config.url,
        url: streamableLaunch.config.url,
        headers: streamableLaunch.config.headers,
      };
    }
  }

  const sseLaunch = resolveHttpMcpServerLaunchConfig(rawServer, {
    transportType: "sse",
  });
  if (sseLaunch.ok) {
    return {
      name,
      status: "ok",
      transportType: "sse",
      connectionTimeoutMs,
      target: sseLaunch.config.url,
      url: sseLaunch.config.url,
      headers: sseLaunch.config.headers,
    };
  }

  const httpLaunch = resolveHttpMcpServerLaunchConfig(rawServer);
  const httpReason = httpLaunch.ok ? "not an HTTP MCP server" : httpLaunch.reason;
  return {
    name,
    status: "invalid",
    reason: `${stdioLaunch.reason} and ${httpReason}`,
  };
}

export function inspectConfiguredMcpServers(
  mcpServers: Record<string, Record<string, unknown>>,
): InspectedConfiguredMcpServer[] {
  return Object.entries(mcpServers)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, rawServer]) => inspectConfiguredMcpServer(name, rawServer));
}

export function formatConfiguredMcpServerListLine(server: InspectedConfiguredMcpServer): string {
  if (server.status !== "ok") {
    return `- ${server.name} [invalid] ${server.reason}`;
  }
  return `- ${server.name} [${server.transportType}] ${server.target}`;
}

export function formatConfiguredMcpServerDetailLines(
  server: InspectedConfiguredMcpServer,
): string[] {
  if (server.status !== "ok") {
    return ["Effective transport: invalid", `Issue: ${server.reason}`];
  }

  const lines = [`Effective transport: ${server.transportType}`];
  if (server.transportType === "stdio") {
    lines.push(`Launch: ${server.target}`);
    if (server.cwd) {
      lines.push(`Working directory: ${formatSingleToken(server.cwd)}`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push(`Environment: ${formatKeyValuePairs(server.env)}`);
    }
  } else {
    lines.push(`URL: ${server.url ?? server.target}`);
    if (server.headers && Object.keys(server.headers).length > 0) {
      lines.push(`Headers: ${formatKeyValuePairs(server.headers)}`);
    }
  }
  lines.push(`Connection timeout: ${server.connectionTimeoutMs}ms`);
  return lines;
}

export function normalizeConfiguredMcpServerInput(
  value: unknown,
): Record<string, Record<string, unknown>> {
  if (!isMcpConfigRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, server]) => isMcpConfigRecord(server))
      .map(([name, server]) => [name, { ...(server as Record<string, unknown>) }]),
  );
}
