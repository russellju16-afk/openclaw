import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.ts";
import { loadBundledEntryExportSync } from "./channel-entry-contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
  vi.doUnmock("jiti");
  vi.unstubAllEnvs();
});

describe("loadBundledEntryExportSync", () => {
  it("includes importer and resolved path context when a bundled sidecar is missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");

    let thrown: unknown;
    try {
      loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('bundled plugin entry "./src/secret-contract.js" failed to open');
    expect(message).toContain(`from "${importerPath}"`);
    expect(message).toContain(`resolved "${path.join(pluginRoot, "src", "secret-contract.js")}"`);
    expect(message).toContain(`plugin root "${pluginRoot}"`);
    expect(message).toContain('reason "path"');
    expect(message).toContain("ENOENT");
  });

  it("keeps Windows dist sidecar loads off Jiti native import", async () => {
    const createJiti = vi.fn(() => vi.fn(() => ({ load: 42 })));
    vi.doMock("jiti", () => ({
      createJiti,
    }));
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    try {
      const channelEntryContract = await importFreshModule<
        typeof import("./channel-entry-contract.js")
      >(import.meta.url, "./channel-entry-contract.js?scope=windows-dist-jiti");
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
      tempDirs.push(tempRoot);

      const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
      fs.mkdirSync(pluginRoot, { recursive: true });

      const importerPath = path.join(pluginRoot, "index.js");
      const helperPath = path.join(pluginRoot, "helper.ts");
      fs.writeFileSync(importerPath, "export default {};\n", "utf8");
      fs.writeFileSync(helperPath, "export const load = 42;\n", "utf8");

      expect(
        channelEntryContract.loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
          specifier: "./helper.ts",
          exportName: "load",
        }),
      ).toBe(42);
      expect(createJiti).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tryNative: false,
        }),
      );
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("loads packaged telegram setup sidecars from dist-facing api modules", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "setup-entry.js");
    const setupApiPath = path.join(pluginRoot, "setup-plugin-api.js");
    const secretsApiPath = path.join(pluginRoot, "secret-contract-api.js");

    fs.writeFileSync(importerPath, "export default {};\n", "utf8");
    fs.writeFileSync(
      setupApiPath,
      'export const telegramSetupPlugin = { id: "telegram" };\n',
      "utf8",
    );
    fs.writeFileSync(
      secretsApiPath,
      [
        "export const collectRuntimeConfigAssignments = () => [];",
        "export const secretTargetRegistryEntries = [];",
        'export const channelSecrets = { TELEGRAM_TOKEN: { env: "TELEGRAM_TOKEN" } };',
        "",
      ].join("\n"),
      "utf8",
    );

    expect(
      loadBundledEntryExportSync<{ id: string }>(pathToFileURL(importerPath).href, {
        specifier: "./setup-plugin-api.js",
        exportName: "telegramSetupPlugin",
      }),
    ).toEqual({ id: "telegram" });

    expect(
      loadBundledEntryExportSync<Record<string, unknown>>(pathToFileURL(importerPath).href, {
        specifier: "./secret-contract-api.js",
        exportName: "channelSecrets",
      }),
    ).toEqual({
      TELEGRAM_TOKEN: {
        env: "TELEGRAM_TOKEN",
      },
    });
  });

  describe("module shape variants (X-007)", () => {
    function makePluginRoot(prefix: string): {
      tempRoot: string;
      pluginRoot: string;
      importerPath: string;
    } {
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), `openclaw-channel-entry-contract-${prefix}-`),
      );
      tempDirs.push(tempRoot);
      const pluginRoot = path.join(tempRoot, "dist", "extensions", "test-plugin");
      fs.mkdirSync(pluginRoot, { recursive: true });
      const importerPath = path.join(pluginRoot, "index.js");
      fs.writeFileSync(importerPath, "export default {};\n", "utf8");
      return { tempRoot, pluginRoot, importerPath };
    }

    it("loads the default export when no exportName is set (default-only module shape)", () => {
      const { pluginRoot, importerPath } = makePluginRoot("default-only");
      fs.writeFileSync(
        path.join(pluginRoot, "api.ts"),
        'export default { kind: "plugin" };\n',
        "utf8",
      );

      expect(
        loadBundledEntryExportSync<{ kind: string }>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
        }),
      ).toEqual({ kind: "plugin" });
    });

    it("loads a named export from a module that has only named exports (named-only module shape)", () => {
      const { pluginRoot, importerPath } = makePluginRoot("named-only");
      fs.writeFileSync(
        path.join(pluginRoot, "api.ts"),
        'export const secrets = { TOKEN: { env: "TOKEN" } };\nexport const version = 2;\n',
        "utf8",
      );

      expect(
        loadBundledEntryExportSync<Record<string, unknown>>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
          exportName: "secrets",
        }),
      ).toEqual({ TOKEN: { env: "TOKEN" } });

      expect(
        loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
          exportName: "version",
        }),
      ).toBe(2);
    });

    it("loads a named export from a module that has BOTH a default export and named exports (X-007 regression)", () => {
      // This is the broken shape: before the fix, `exportName="secrets"` would
      // look inside `default` (a non-null object that lacks the key) and throw
      // `missing export "secrets"` even though the module namespace has it.
      const { pluginRoot, importerPath } = makePluginRoot("both-shapes");
      fs.writeFileSync(
        path.join(pluginRoot, "api.ts"),
        [
          'export default { id: "channel-plugin" };',
          'export const secrets = { API_KEY: { env: "API_KEY" } };',
          "export const version = 3;",
          "",
        ].join("\n"),
        "utf8",
      );

      // Named export from the namespace must win over the default object.
      expect(
        loadBundledEntryExportSync<Record<string, unknown>>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
          exportName: "secrets",
        }),
      ).toEqual({ API_KEY: { env: "API_KEY" } });

      expect(
        loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
          exportName: "version",
        }),
      ).toBe(3);

      // Default export (no exportName) still works.
      expect(
        loadBundledEntryExportSync<{ id: string }>(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
        }),
      ).toEqual({ id: "channel-plugin" });
    });

    it("throws a clear error when the named export is missing from both namespace and default", () => {
      const { pluginRoot, importerPath } = makePluginRoot("missing-export");
      fs.writeFileSync(
        path.join(pluginRoot, "api.ts"),
        'export default { id: "plugin" };\nexport const version = 1;\n',
        "utf8",
      );

      expect(() =>
        loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
          specifier: "./api.ts",
          exportName: "nonExistentExport",
        }),
      ).toThrow('missing export "nonExistentExport" from bundled entry module ./api.ts');
    });
  });

  it("can disable source-tree fallback for dist bundled entry checks", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    fs.writeFileSync(path.join(tempRoot, "package.json"), '{"name":"openclaw"}\n', "utf8");
    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    const sourceRoot = path.join(tempRoot, "extensions", "telegram", "src");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(sourceRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");
    fs.writeFileSync(
      path.join(sourceRoot, "secret-contract.ts"),
      "export const sentinel = 42;\n",
      "utf8",
    );

    expect(
      loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
        exportName: "sentinel",
      }),
    ).toBe(42);

    vi.stubEnv("OPENCLAW_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK", "1");

    expect(() =>
      loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
        exportName: "sentinel",
      }),
    ).toThrow(`resolved "${path.join(pluginRoot, "src", "secret-contract.js")}"`);
  });
});
