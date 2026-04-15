import { describe, expect, it } from "vitest";
import { describeHttpMcpServerLaunchConfig } from "./mcp-http.js";

describe("describeHttpMcpServerLaunchConfig", () => {
  it("includes the transport type in the description", () => {
    expect(
      describeHttpMcpServerLaunchConfig({
        transportType: "streamable-http",
        url: "https://mcp.example.com/http",
      }),
    ).toBe("streamable-http https://mcp.example.com/http");
  });
});
