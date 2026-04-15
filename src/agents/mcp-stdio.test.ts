import { describe, expect, it } from "vitest";
import { describeStdioMcpServerLaunchConfig } from "./mcp-stdio.js";

describe("describeStdioMcpServerLaunchConfig", () => {
  it("quotes args with spaces and quotes", () => {
    const result = describeStdioMcpServerLaunchConfig({
      command: "node",
      args: ['server "alpha".mjs', "--message=hello world"],
    });

    expect(result).toBe('node "server \\"alpha\\".mjs" "--message=hello world"');
  });

  it("quotes cwd when it contains whitespace", () => {
    const result = describeStdioMcpServerLaunchConfig({
      command: "uvx",
      args: ["context7-mcp"],
      cwd: "/tmp/work dir",
    });

    expect(result).toBe('uvx context7-mcp (cwd="/tmp/work dir")');
  });
});
