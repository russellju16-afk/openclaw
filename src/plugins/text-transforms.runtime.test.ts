import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginRegistry } from "./registry-types.js";
import type { PluginTextTransforms } from "./types.js";

// X-015 regression: text-transforms.runtime.ts previously used createRequire()
// to load ./runtime.js (a CJS-require of an ESM module) with a silent-catch
// fallback that swallowed real load failures. The fix replaces this with a
// direct static import. These tests verify:
//   1. resolveRuntimeTextTransforms correctly delegates to getActivePluginRegistry.
//   2. When the registry has text transforms, they are merged and returned.
//   3. When the registry is null (no active registry), undefined is returned.
//   4. The static import path means mock interception works — confirming the
//      old createRequire bypass is gone.

const mocks = vi.hoisted(() => ({
  getActivePluginRegistry: vi.fn<() => PluginRegistry | null>(() => null),
}));

vi.mock("./runtime.js", () => ({
  getActivePluginRegistry: mocks.getActivePluginRegistry,
}));

let resolveRuntimeTextTransforms: typeof import("./text-transforms.runtime.js").resolveRuntimeTextTransforms;

beforeEach(async () => {
  vi.resetModules();
  mocks.getActivePluginRegistry.mockReturnValue(null);
  ({ resolveRuntimeTextTransforms } = await import("./text-transforms.runtime.js"));
});

describe("resolveRuntimeTextTransforms (X-015)", () => {
  it("returns undefined when no active plugin registry is set", () => {
    mocks.getActivePluginRegistry.mockReturnValue(null);
    const result = resolveRuntimeTextTransforms();
    expect(result).toBeUndefined();
  });

  it("returns undefined when the active registry has no text transforms", () => {
    mocks.getActivePluginRegistry.mockReturnValue({
      textTransforms: [],
    } as unknown as PluginRegistry);

    const result = resolveRuntimeTextTransforms();
    expect(result).toBeUndefined();
  });

  it("merges and returns text transforms from the active registry", () => {
    // PluginTextTransformRegistration = PluginTextTransforms (from plugin-sdk dist types).
    // PluginTextReplacement uses { from, to } fields.
    const transforms: PluginTextTransforms = {
      input: [{ from: "hello", to: "hi" }],
    };
    mocks.getActivePluginRegistry.mockReturnValue({
      textTransforms: [{ transforms, pluginId: "test-plugin", source: "test" }],
    } as unknown as PluginRegistry);

    const result = resolveRuntimeTextTransforms();
    expect(result).toBeDefined();
    expect(result?.input).toEqual([{ from: "hello", to: "hi" }]);
  });

  it("merges text transforms from multiple plugins", () => {
    const transforms1: PluginTextTransforms = {
      input: [{ from: "foo", to: "bar" }],
    };
    const transforms2: PluginTextTransforms = {
      input: [{ from: "baz", to: "qux" }],
    };
    mocks.getActivePluginRegistry.mockReturnValue({
      textTransforms: [
        { transforms: transforms1, pluginId: "plugin-a", source: "test" },
        { transforms: transforms2, pluginId: "plugin-b", source: "test" },
      ],
    } as unknown as PluginRegistry);

    const result = resolveRuntimeTextTransforms();
    expect(result).toBeDefined();
    // Both transform rules should be present in the merged output.
    expect(result?.input).toEqual([
      { from: "foo", to: "bar" },
      { from: "baz", to: "qux" },
    ]);
  });

  it("calls getActivePluginRegistry via static import so errors surface directly (X-015 regression guard)", () => {
    // If the old createRequire path were still in use, vi.mock("./runtime.js")
    // would not intercept the call and this spy assertion would fail.
    const spy = mocks.getActivePluginRegistry.mockReturnValue(null);
    resolveRuntimeTextTransforms();
    expect(spy).toHaveBeenCalled();
  });
});
