import { describe, expect, it } from "vitest";
import { resolveSenderCommandAuthorization as resolveFromCommandAuth } from "./command-auth.js";
import { resolveSenderCommandAuthorization as resolveFromLegacyAlias } from "./zalouser.js";

describe("plugin-sdk/zalouser", () => {
  it("keeps the legacy command authorization alias wired to command-auth", () => {
    expect(resolveFromLegacyAlias).toBe(resolveFromCommandAuth);
  });
});
