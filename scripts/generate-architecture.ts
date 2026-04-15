#!/usr/bin/env node
/**
 * Generates ARCHITECTURE.md at the repo root from live codebase introspection.
 *
 * Usage:
 *   pnpm arch:gen        — write ARCHITECTURE.md
 *   pnpm arch:check      — validate that the file is up-to-date (exit 1 if drift)
 *
 * Self-contained: uses only Node built-ins (fs, path, child_process).
 * No src/ imports. Works without building the project first.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const writeMode = args.has("--write");

if (checkOnly && writeMode) {
  console.error("Use either --check or --write, not both.");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "ARCHITECTURE.md");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function parseJsonSafe<T>(filePath: string): Promise<T | null> {
  const content = await readFileSafe(filePath);
  if (content === null) {
    return null;
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    console.warn(`Warning: failed to parse JSON at ${filePath}`);
    return null;
  }
}

/** Recursively walk a directory, excluding certain folder names. */
async function walk(
  dir: string,
  exclude: string[] = ["node_modules", "dist", ".build", "apps"],
): Promise<string[]> {
  const results: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(full, exclude);
      results.push(...sub);
    } else {
      results.push(full);
    }
  }
  return results;
}

/** Return paths matching `filename` under `dir`, honoring the exclusion list. */
async function findFiles(
  dir: string,
  filename: string,
  exclude: string[] = ["node_modules", "dist", ".build", "apps"],
): Promise<string[]> {
  const all = await walk(dir, exclude);
  return all.filter((f) => path.basename(f) === filename).toSorted();
}

function rel(p: string): string {
  return path.relative(repoRoot, p);
}

function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const sep = widths.map((w) => "-".repeat(w));
  const fmt = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ") + " |";
  return [fmt(headers), fmt(sep), ...rows.map(fmt)].join("\n");
}

// ---------------------------------------------------------------------------
// §0 Header
// ---------------------------------------------------------------------------

async function generateHeader(root: string): Promise<string> {
  const pkg = await parseJsonSafe<{ version?: string }>(path.join(root, "package.json"));
  const version = pkg?.version ?? "unknown";
  return `# OpenClaw Architecture

<!-- AUTO-GENERATED — do not edit by hand. Regenerate: pnpm arch:gen -->
<!-- version: ${version} -->

> This document is auto-generated from the codebase. It provides architectural orientation
> for AI coding assistants (Claude Code, Codex) and human developers.
> Run \`pnpm arch:gen\` to refresh. Validate with \`pnpm arch:check\`.`;
}

// ---------------------------------------------------------------------------
// §1 System Overview
// ---------------------------------------------------------------------------

async function generateSystemOverview(root: string): Promise<string> {
  interface PkgJson {
    version?: string;
    description?: string;
    engines?: { node?: string };
    type?: string;
  }
  const pkg = await parseJsonSafe<PkgJson>(path.join(root, "package.json"));
  const version = pkg?.version ?? "unknown";
  const description =
    pkg?.description ?? "Multi-channel AI gateway with extensible messaging integrations";
  const nodeReq = pkg?.engines?.node ?? ">=22";

  // Extract first non-empty paragraph after the title from VISION.md
  let visionSnippet = "";
  const vision = await readFileSafe(path.join(root, "VISION.md"));
  if (vision) {
    const lines = vision.split("\n");
    let inParagraph = false;
    const paraLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#")) {
        continue;
      } // skip headings
      if (line.trim() === "") {
        if (inParagraph) {
          break;
        }
        continue;
      }
      inParagraph = true;
      paraLines.push(line.trim());
    }
    visionSnippet = paraLines.join(" ");
  }

  const rows = [
    ["Version", version],
    ["Runtime", `Node ${nodeReq}, TypeScript ESM`],
    ["Package Manager", "pnpm (workspace monorepo)"],
    ["Repository", "https://github.com/openclaw/openclaw"],
  ];

  let out = `## System Overview

OpenClaw is ${description}.`;

  if (visionSnippet) {
    out += `\n\n${visionSnippet}`;
  }

  out += `\n\n${mdTable(["Property", "Value"], rows)}`;
  return out;
}

// ---------------------------------------------------------------------------
// §2 Component Map
// ---------------------------------------------------------------------------

async function generateComponentMap(root: string): Promise<string> {
  const srcDir = path.join(root, "src");
  let srcEntries: Awaited<ReturnType<typeof fs.readdir>> = [];
  try {
    srcEntries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return `## Component Map\n\n_Could not read \`src/\` directory._`;
  }

  const srcDirs = srcEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name.toString())
    .toSorted((left, right) => left.localeCompare(right));

  // Gather all AGENTS.md files anywhere in the repo (excluding heavy dirs)
  const agentsFiles = await findFiles(root, "AGENTS.md", [
    "node_modules",
    "dist",
    ".build",
    "apps/macos/.build",
  ]);

  // Build a lookup: relative path -> first content line
  const agentsIndex: Record<string, string> = {};
  for (const f of agentsFiles) {
    const content = await readFileSafe(f);
    const firstLine =
      content
        ?.split("\n")
        .find((l) => l.trim() && !l.startsWith("#"))
        ?.trim() ?? "";
    agentsIndex[rel(f)] = firstLine;
  }

  // Module table: for each src/ dir, check if it has an AGENTS.md
  const moduleRows: string[][] = srcDirs.map((d) => {
    const agentsRelPath = `src/${d}/AGENTS.md`;
    const hasGuide = agentsRelPath in agentsIndex;
    return [`\`${d}\``, hasGuide ? `\`${agentsRelPath}\`` : "—"];
  });

  // Boundary guides table: all AGENTS.md files sorted
  const guideRows: string[][] = Object.entries(agentsIndex)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([filePath, summary]) => {
      const display = summary.length > 80 ? summary.slice(0, 77) + "…" : summary;
      return [`\`${filePath}\``, display || "—"];
    });

  return `## Component Map

### Source Modules (\`src/\`)

${mdTable(["Module", "Has Boundary Guide"], moduleRows)}

### Architecture Boundary Guides

${mdTable(["Path", "Summary"], guideRows)}`;
}

// ---------------------------------------------------------------------------
// §3 Architecture Boundaries (full AGENTS.md content)
// ---------------------------------------------------------------------------

async function generateArchitectureBoundaries(root: string): Promise<string> {
  // Only include AGENTS.md files under src/, extensions/, and test/
  const roots = ["src", "extensions", "test"];
  const sections: string[] = [];

  for (const sub of roots) {
    const dir = path.join(root, sub);
    const files = await findFiles(dir, "AGENTS.md", ["node_modules", "dist", ".build"]);
    for (const f of files.toSorted()) {
      const content = await readFileSafe(f);
      if (!content) {
        continue;
      }
      const relPath = rel(f);
      // Derive a friendly heading from the directory path
      const dirPart = path.dirname(relPath);
      sections.push(`### \`${dirPart}/\`\n\n${content.trimEnd()}`);
    }
  }

  if (sections.length === 0) {
    return `## Architecture Boundaries\n\n_No boundary guides found._`;
  }

  return `## Architecture Boundaries\n\n${sections.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// §4 Data Flow
// ---------------------------------------------------------------------------

async function generateDataFlow(root: string): Promise<string> {
  // Extract relevant sections from architecture.md
  let archSection = "";
  const archMd = await readFileSafe(path.join(root, "docs/concepts/architecture.md"));
  if (archMd) {
    // Keep the "Connection lifecycle" section and the mermaid block within
    const lines = archMd.split("\n");
    let capturing = false;
    const kept: string[] = [];
    for (const line of lines) {
      // Start capturing at "## Connection lifecycle" or "## Wire protocol"
      if (line.match(/^## .*(connection lifecycle|wire protocol|components|flows)/i)) {
        capturing = true;
      } else if (capturing && line.startsWith("## ")) {
        // Stop at next top-level section
        break;
      }
      if (capturing) {
        kept.push(line);
      }
    }
    archSection = kept.join("\n").trimEnd();
  }

  // Extract high-level steps from agent-loop.md
  let loopSection = "";
  const loopMd = await readFileSafe(path.join(root, "docs/concepts/agent-loop.md"));
  if (loopMd) {
    const lines = loopMd.split("\n");
    let capturing = false;
    const kept: string[] = [];
    for (const line of lines) {
      if (line.match(/^## how it works/i)) {
        capturing = true;
        continue;
      } else if (capturing && line.startsWith("## ")) {
        break;
      }
      if (capturing) {
        kept.push(line);
      }
    }
    loopSection = kept.join("\n").trimEnd();
  }

  let out = `## Data Flow

### Gateway Wire Protocol

> Source: \`docs/concepts/architecture.md\`

`;

  if (archSection) {
    out += archSection + "\n";
  } else {
    out += "_`docs/concepts/architecture.md` not found or section missing._\n";
  }

  out += `
### Agent Execution Cycle

> Source: \`docs/concepts/agent-loop.md\`

`;

  if (loopSection) {
    out += loopSection + "\n";
  } else {
    out += "_`docs/concepts/agent-loop.md` not found or section missing._\n";
  }

  return out.trimEnd();
}

// ---------------------------------------------------------------------------
// §5 Plugin SDK Public Surface
// ---------------------------------------------------------------------------

async function generatePluginSdkSurface(root: string): Promise<string> {
  const sdkDir = path.join(root, "src/plugin-sdk");
  let tsFiles: string[] = [];
  try {
    const entries = await fs.readdir(sdkDir, { withFileTypes: true });
    tsFiles = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".ts") &&
          !e.name.endsWith(".test.ts") &&
          !e.name.endsWith(".d.ts"),
      )
      .map((e) => e.name)
      .toSorted();
  } catch {
    return `## Plugin SDK Public Surface\n\n_Could not read \`src/plugin-sdk/\`._`;
  }

  interface PkgJson {
    exports?: Record<string, unknown>;
  }
  const pkg = await parseJsonSafe<PkgJson>(path.join(root, "package.json"));
  const exports = pkg?.exports ?? {};

  const sdkKeys = Object.keys(exports)
    .filter((k) => k.startsWith("./plugin-sdk"))
    .toSorted();

  // Build table: subpath -> entry file guess
  const subpathRows: string[][] = sdkKeys.map((k) => {
    // "./plugin-sdk/foo" -> "src/plugin-sdk/foo.ts"
    const stem = k.replace("./", "src/") + ".ts";
    // Handle the bare "./plugin-sdk" -> "src/plugin-sdk/index.ts"
    const entry = k === "./plugin-sdk" ? "src/plugin-sdk/index.ts" : stem;
    return [`\`openclaw/${k.slice(2)}\``, `\`${entry}\``];
  });

  return `## Plugin SDK Public Surface

The Plugin SDK (\`src/plugin-sdk/\`) contains ${tsFiles.length} source files exposing ${sdkKeys.length} public subpaths.

### Exported Subpaths

${mdTable(["Subpath", "Entry"], subpathRows)}`;
}

// ---------------------------------------------------------------------------
// §6 Plugin & Provider Map
// ---------------------------------------------------------------------------

interface PluginManifest {
  id: string;
  name?: string;
  kind?: string;
  channels?: string[];
  providers?: string[];
  contracts?: Record<string, unknown>;
}

async function generatePluginProviderMap(root: string): Promise<string> {
  const manifestPaths = await findFiles(path.join(root, "extensions"), "openclaw.plugin.json", [
    "node_modules",
    "dist",
    ".build",
  ]);

  const plugins: PluginManifest[] = [];
  for (const mp of manifestPaths) {
    const parsed = await parseJsonSafe<PluginManifest>(mp);
    if (parsed?.id) {
      plugins.push(parsed);
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));

  const channelPlugins = plugins.filter((p) => p.channels && p.channels.length > 0);
  const providerPlugins = plugins.filter(
    (p) => p.providers && p.providers.length > 0 && !p.channels?.length,
  );
  const otherPlugins = plugins.filter((p) => !p.channels?.length && !p.providers?.length);

  const channelRows: string[][] = channelPlugins.map((p) => [
    `\`${p.id}\``,
    (p.channels ?? []).join(", "),
  ]);

  const providerRows: string[][] = providerPlugins.map((p) => {
    const caps = Object.keys(p.contracts ?? {}).join(", ");
    return [`\`${p.id}\``, (p.providers ?? []).join(", "), caps || "—"];
  });

  const otherRows: string[][] = otherPlugins.map((p) => {
    const kind = p.kind ?? "—";
    const desc = p.name ?? "—";
    return [`\`${p.id}\``, kind, desc];
  });

  return `## Plugin & Provider Map

${plugins.length} bundled plugins in \`extensions/\`.

### Channel Plugins (${channelPlugins.length})

${mdTable(["Plugin ID", "Channels"], channelRows)}

### Provider Plugins (${providerPlugins.length})

${mdTable(["Plugin ID", "Providers", "Capabilities"], providerRows)}

### Other Plugins (${otherPlugins.length})

${mdTable(["Plugin ID", "Kind", "Name / Description"], otherRows)}`;
}

// ---------------------------------------------------------------------------
// §7 Tech Stack
// ---------------------------------------------------------------------------

async function generateTechStack(root: string): Promise<string> {
  interface PkgJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
  const pkg = await parseJsonSafe<PkgJson>(path.join(root, "package.json"));
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
  };

  const lookup = (name: string) => deps[name] ?? null;

  type PackageEntry = { name: string; role: string };
  type Group = { heading: string; packages: PackageEntry[] };

  const groups: Group[] = [
    {
      heading: "Runtime Core",
      packages: [
        { name: "hono", role: "HTTP server framework" },
        { name: "ws", role: "WebSocket server/client" },
        { name: "commander", role: "CLI framework" },
        { name: "zod", role: "Schema validation" },
        { name: "@sinclair/typebox", role: "Runtime JSON Schema / TypeBox" },
        { name: "jiti", role: "Runtime TS imports (jiti alias)" },
        { name: "undici", role: "HTTP client" },
        { name: "chokidar", role: "File watching" },
        { name: "croner", role: "Cron scheduler" },
        { name: "tslog", role: "Structured logging" },
        { name: "yaml", role: "YAML parser" },
        { name: "ajv", role: "JSON Schema validator" },
      ],
    },
    {
      heading: "AI & Agent",
      packages: [
        { name: "@mariozechner/pi-agent-core", role: "Pi agent runtime core" },
        { name: "@mariozechner/pi-ai", role: "Pi AI client" },
        { name: "@mariozechner/pi-coding-agent", role: "Pi coding agent" },
        { name: "@mariozechner/pi-tui", role: "Pi TUI rendering" },
        { name: "@modelcontextprotocol/sdk", role: "MCP SDK" },
        { name: "@agentclientprotocol/sdk", role: "ACP SDK" },
        { name: "@anthropic-ai/vertex-sdk", role: "Anthropic Vertex AI SDK" },
        { name: "@aws-sdk/client-bedrock", role: "AWS Bedrock client" },
        { name: "sqlite-vec", role: "SQLite vector search" },
      ],
    },
    {
      heading: "Channel SDKs",
      packages: [
        { name: "matrix-js-sdk", role: "Matrix protocol client" },
        { name: "grammy", role: "Telegram bot framework" },
      ],
    },
    {
      heading: "Media & Processing",
      packages: [
        { name: "sharp", role: "Image processing" },
        { name: "playwright-core", role: "Browser automation" },
        { name: "pdfjs-dist", role: "PDF parsing" },
      ],
    },
    {
      heading: "Build & Dev",
      packages: [
        { name: "typescript", role: "Type checker" },
        { name: "tsdown", role: "Bundle builder (tsdown)" },
        { name: "vitest", role: "Test runner" },
        { name: "tsx", role: "TS script runner" },
        { name: "oxlint", role: "Linter" },
        { name: "lit", role: "Web components (canvas host)" },
      ],
    },
  ];

  const parts: string[] = ["## Tech Stack\n"];

  for (const g of groups) {
    const rows: string[][] = [];
    for (const pkg of g.packages) {
      const version = lookup(pkg.name);
      if (!version) {
        continue;
      }
      rows.push([`\`${pkg.name}\``, version, pkg.role]);
    }
    if (rows.length === 0) {
      continue;
    }
    parts.push(`### ${g.heading}\n`);
    parts.push(mdTable(["Package", "Version", "Role"], rows));
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// §8 Build Pipeline
// ---------------------------------------------------------------------------

async function generateBuildPipeline(_root: string): Promise<string> {
  const rows: string[][] = [
    ["`pnpm build`", "Full production build (tsdown bundle → DTS → postbuild steps)"],
    ["`pnpm check`", "Conflict markers + Swift policy + tsgo + oxlint + webhook/auth lints"],
    ["`pnpm tsgo`", "TypeScript type-check (native preview compiler)"],
    ["`pnpm format`", "Code formatting (oxfmt --write)"],
    ["`pnpm lint`", "Linting (oxlint)"],
    ["`pnpm test`", "Run all test projects (vitest, forks pool)"],
    ["`pnpm test:coverage`", "Unit tests with V8 coverage"],
  ];

  return `## Build Pipeline

${mdTable(["Command", "What It Does"], rows)}`;
}

// ---------------------------------------------------------------------------
// §9 Test Surfaces
// ---------------------------------------------------------------------------

async function generateTestSurfaces(root: string): Promise<string> {
  let configFiles: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    configFiles = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.startsWith("vitest.") &&
          e.name.endsWith(".config.ts") &&
          e.name !== "vitest.config.ts" &&
          e.name !== "vitest.projects.config.ts",
      )
      .map((e) => e.name)
      .toSorted();
  } catch {
    configFiles = [];
  }

  // Map known config names to metadata
  const known: Record<string, [string, string]> = {
    "vitest.unit.config.ts": ["Unit tests (`src/**`)", "`pnpm test:coverage`"],
    "vitest.gateway.config.ts": ["Gateway tests", "`pnpm test:gateway`"],
    "vitest.channels.config.ts": ["Channel tests", "`pnpm test:channels`"],
    "vitest.bundled.config.ts": ["Bundled plugin tests", "`pnpm test:bundled`"],
    "vitest.extensions.config.ts": ["Extension tests", "`pnpm test:extensions`"],
    "vitest.contracts.config.ts": ["Contract tests", "`pnpm test:contracts`"],
    "vitest.boundary.config.ts": ["Boundary enforcement", "—"],
    "vitest.e2e.config.ts": ["E2E tests", "`pnpm test:e2e`"],
    "vitest.live.config.ts": ["Live/real-key tests", "`pnpm test:live`"],
  };

  const rows: string[][] = configFiles.map((f) => {
    const [surface, cmd] = known[f] ?? [f.replace("vitest.", "").replace(".config.ts", ""), "—"];
    return [`\`${f}\``, surface, cmd];
  });

  return `## Test Surfaces

Pool: \`forks\` only (threads/vmThreads/vmForks forbidden).
Coverage: V8, thresholds 70% lines/functions/statements, 55% branches.

${mdTable(["Config", "Surface", "Command"], rows)}`;
}

// ---------------------------------------------------------------------------
// §10 Generated Artifacts
// ---------------------------------------------------------------------------

async function generateGeneratedArtifacts(root: string): Promise<string> {
  // Scan package.json scripts for *:gen / *:check pairs
  interface PkgJson {
    scripts?: Record<string, string>;
  }
  const pkg = await parseJsonSafe<PkgJson>(path.join(root, "package.json"));
  const scripts = pkg?.scripts ?? {};

  const genKeys = Object.keys(scripts)
    .filter((k) => k.endsWith(":gen"))
    .toSorted();

  // Known artifact metadata
  const knownArtifacts: Record<string, { artifact: string; generator: string; check: string }> = {
    "config:docs:gen": {
      artifact: "`docs/.generated/config-baseline.json`",
      generator: "`scripts/generate-config-doc-baseline.ts`",
      check: "`pnpm config:docs:check`",
    },
    "plugin-sdk:api:gen": {
      artifact: "`docs/.generated/plugin-sdk-api-baseline.json`",
      generator: "`scripts/generate-plugin-sdk-api-baseline.ts`",
      check: "`pnpm plugin-sdk:api:check`",
    },
    "arch:gen": {
      artifact: "`ARCHITECTURE.md`",
      generator: "`scripts/generate-architecture.ts`",
      check: "`pnpm arch:check`",
    },
    "protocol:gen": {
      artifact: "`src/gateway/protocol/schema.ts` (generated)",
      generator: "`scripts/protocol-gen.ts`",
      check: "`pnpm protocol:check`",
    },
    "protocol:gen:swift": {
      artifact: "Swift protocol bindings (`apps/macos/…`)",
      generator: "`scripts/protocol-gen-swift.ts`",
      check: "—",
    },
    "config:schema:gen": {
      artifact: "`src/config/schema.base.generated.ts`",
      generator: "`scripts/generate-base-config-schema.ts`",
      check: "`pnpm config:schema:check`",
    },
    "config:channels:gen": {
      artifact: "Bundled channel config metadata",
      generator: "`scripts/generate-bundled-channel-config-metadata.ts`",
      check: "`pnpm config:channels:check`",
    },
    "plugin-sdk:facades:gen": {
      artifact: "Plugin SDK facade files",
      generator: "`scripts/generate-plugin-sdk-facades.mjs`",
      check: "`pnpm plugin-sdk:facades:check`",
    },
    "ios:gen": {
      artifact: "iOS version xcconfig",
      generator: "`scripts/ios-write-version-xcconfig.sh`",
      check: "—",
    },
  };

  const rows: string[][] = [];
  for (const key of genKeys) {
    const meta = knownArtifacts[key];
    if (meta) {
      rows.push([meta.artifact, meta.generator, `\`pnpm ${key}\``, meta.check]);
    } else {
      rows.push(["—", "—", `\`pnpm ${key}\``, `\`pnpm ${key.replace(":gen", ":check")}\``]);
    }
  }

  // Always include arch:gen even if it's already in package.json (it may be new)
  const alreadyHasArch = rows.some((r) => r[2] === "`pnpm arch:gen`");
  if (!alreadyHasArch) {
    rows.push([
      "`ARCHITECTURE.md`",
      "`scripts/generate-architecture.ts`",
      "`pnpm arch:gen`",
      "`pnpm arch:check`",
    ]);
  }

  rows.sort((a, b) => a[2].localeCompare(b[2]));

  return `## Generated Artifacts

Do not edit these files by hand. Regenerate with the listed commands.

${mdTable(["Artifact", "Generator", "Regenerate", "Validate"], rows)}`;
}

// ---------------------------------------------------------------------------
// §11 Boundary Violations
// ---------------------------------------------------------------------------

async function generateBoundaryViolations(root: string): Promise<string> {
  const extDir = path.join(root, "extensions");
  const allFiles = await walk(extDir, ["node_modules", "dist", ".build"]);
  const tsFiles = allFiles.filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"),
  );

  type Violation = {
    file: string;
    line: number;
    importPath: string;
    kind: string;
  };
  const violations: Violation[] = [];

  const importRe = /(?:import|from)\s+["']([^"']+)["']/g;

  for (const filePath of tsFiles) {
    const content = await readFileSafe(filePath);
    if (!content) {
      continue;
    }
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(line)) !== null) {
        const imp = m[1];
        // 1. Any relative import that resolves into root/src/
        if (imp.startsWith(".")) {
          const resolved = path.resolve(path.dirname(filePath), imp);
          if (resolved.startsWith(path.join(root, "src") + path.sep)) {
            violations.push({
              file: filePath,
              line: i + 1,
              importPath: imp,
              kind: "relative-escape",
            });
            continue;
          }
        }
        // 2. Bare specifier reaching into core src/
        if (imp.match(/^openclaw\/src\//)) {
          violations.push({
            file: filePath,
            line: i + 1,
            importPath: imp,
            kind: "direct-src-import",
          });
        } else if (imp.includes("plugin-sdk-internal")) {
          // 3. SDK internal import
          violations.push({
            file: filePath,
            line: i + 1,
            importPath: imp,
            kind: "sdk-internal-import",
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    return `## Boundary Violations\n\nNo boundary violations detected in \`extensions/\`.`;
  }

  const rows: string[][] = violations.map((v) => [
    `\`${rel(v.file)}:${v.line}\``,
    `\`${v.importPath}\``,
    v.kind,
  ]);

  return `## Boundary Violations

${violations.length} potential violation(s) detected in \`extensions/\`.

${mdTable(["Location", "Import", "Violation Type"], rows)}`;
}

// ---------------------------------------------------------------------------
// §12 Error Catalog
// ---------------------------------------------------------------------------

async function generateErrorCatalog(root: string): Promise<string> {
  const dirs = [path.join(root, "src"), path.join(root, "extensions")];
  const errorClasses: { name: string; parent: string; file: string }[] = [];
  const errorCodes: { name: string; kind: string; file: string }[] = [];

  const classRe = /(?:export\s+)?class\s+(\w+Error)\s+extends\s+(\w+)/g;
  const enumRe = /(?:export\s+)?(?:const\s+enum|enum)\s+(\w*(?:Error|Err)\w*Code\w*)\s*\{/g;
  const typeUnionRe = /(?:export\s+)?type\s+(\w*(?:Error|Err)\w*Code\w*)\s*=\s*/g;
  const constObjRe = /(?:export\s+)?const\s+(\w*(?:ERROR|ERR)\w*CODE\w*)\s*=\s*\{/gi;

  for (const dir of dirs) {
    const files = await walk(dir, ["node_modules", "dist", ".build"]);
    const tsFiles = files.filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".d.ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".harness.ts"),
    );

    for (const filePath of tsFiles) {
      const content = await readFileSafe(filePath);
      if (!content) {
        continue;
      }

      // Error classes
      let m: RegExpExecArray | null;
      classRe.lastIndex = 0;
      while ((m = classRe.exec(content)) !== null) {
        errorClasses.push({ name: m[1], parent: m[2], file: filePath });
      }

      // Error code enums
      enumRe.lastIndex = 0;
      while ((m = enumRe.exec(content)) !== null) {
        errorCodes.push({ name: m[1], kind: "enum", file: filePath });
      }

      // Error code type unions
      typeUnionRe.lastIndex = 0;
      while ((m = typeUnionRe.exec(content)) !== null) {
        errorCodes.push({ name: m[1], kind: "type-union", file: filePath });
      }

      // Error code const objects
      constObjRe.lastIndex = 0;
      while ((m = constObjRe.exec(content)) !== null) {
        errorCodes.push({ name: m[1], kind: "const-object", file: filePath });
      }
    }
  }

  // Deduplicate by name+file
  const seenClasses = new Set<string>();
  const uniqueClasses = errorClasses.filter((c) => {
    const key = `${c.name}:${c.file}`;
    if (seenClasses.has(key)) {
      return false;
    }
    seenClasses.add(key);
    return true;
  });
  uniqueClasses.sort((a, b) => a.name.localeCompare(b.name));

  const seenCodes = new Set<string>();
  const uniqueCodes = errorCodes.filter((c) => {
    const key = `${c.name}:${c.file}`;
    if (seenCodes.has(key)) {
      return false;
    }
    seenCodes.add(key);
    return true;
  });
  uniqueCodes.sort((a, b) => a.name.localeCompare(b.name));

  const classRows: string[][] = uniqueClasses.map((c) => [
    `\`${c.name}\``,
    `\`${c.parent}\``,
    `\`${rel(c.file)}\``,
  ]);

  const codeRows: string[][] = uniqueCodes.map((c) => [
    `\`${c.name}\``,
    c.kind,
    `\`${rel(c.file)}\``,
  ]);

  let out = `## Error Catalog

### Error Classes (${uniqueClasses.length})

`;
  if (classRows.length > 0) {
    out += mdTable(["Class", "Extends", "Defined In"], classRows);
  } else {
    out += "_No custom Error classes found._";
  }

  out += `\n\n### Error Code Types (${uniqueCodes.length})\n\n`;
  if (codeRows.length > 0) {
    out += mdTable(["Name", "Kind", "Defined In"], codeRows);
  } else {
    out += "_No error code types found._";
  }

  return out;
}

// ---------------------------------------------------------------------------
// §13 SDK Exported Symbols
// ---------------------------------------------------------------------------

async function generateSdkExportedSymbols(root: string): Promise<string> {
  const sdkDir = path.join(root, "src/plugin-sdk");
  const entryFiles = [
    "core.ts",
    "channel-contract.ts",
    "provider-entry.ts",
    "provider-auth.ts",
    "plugin-entry.ts",
    "runtime.ts",
    "index.ts",
  ];

  type ExportEntry = { symbol: string; kind: string; file: string };
  const exports: ExportEntry[] = [];

  const namedExportRe =
    /export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
  const reExportRe = /export\s*\{([^}]+)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  const starReExportRe = /export\s*\*\s*(?:as\s+(\w+)\s+)?from\s*["']([^"']+)["']/g;
  const defaultExportRe = /export\s+default\s+(?:(?:function|class)\s+)?(\w+)?/g;

  for (const fileName of entryFiles) {
    const filePath = path.join(sdkDir, fileName);
    const raw = await readFileSafe(filePath);
    if (!raw) {
      continue;
    }

    // Pre-process: join continuation lines (lines ending with comma that continue an export block)
    const content = raw.replace(/,\s*\n\s*/g, ", ");
    const relFile = `src/plugin-sdk/${fileName}`;

    // Named exports
    let m: RegExpExecArray | null;
    namedExportRe.lastIndex = 0;
    while ((m = namedExportRe.exec(content)) !== null) {
      exports.push({ symbol: m[1], kind: "named", file: relFile });
    }

    // Re-exports: export { A, B } from '...'
    reExportRe.lastIndex = 0;
    while ((m = reExportRe.exec(content)) !== null) {
      const symbols = m[1].split(",").map((s) =>
        s
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()!
          .trim(),
      );
      const source = m[2] ?? "(local)";
      for (const sym of symbols) {
        if (sym) {
          exports.push({
            symbol: sym,
            kind: source === "(local)" ? "re-export" : `re-export from ${source}`,
            file: relFile,
          });
        }
      }
    }

    // Star re-exports: export * from '...' or export * as ns from '...'
    starReExportRe.lastIndex = 0;
    while ((m = starReExportRe.exec(content)) !== null) {
      const alias = m[1];
      const source = m[2];
      exports.push({
        symbol: alias ?? `* (barrel)`,
        kind: `star re-export from ${source}`,
        file: relFile,
      });
    }

    // Default exports
    defaultExportRe.lastIndex = 0;
    while ((m = defaultExportRe.exec(content)) !== null) {
      exports.push({
        symbol: m[1] ?? "(anonymous)",
        kind: "default",
        file: relFile,
      });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = exports.filter((e) => {
    const key = `${e.symbol}:${e.file}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Group by file
  const byFile = new Map<string, ExportEntry[]>();
  for (const e of unique) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }

  const parts: string[] = [`## SDK Exported Symbols\n`];
  parts.push(`${unique.length} exported symbols across ${entryFiles.length} SDK entry files.\n`);

  for (const fileName of entryFiles) {
    const relFile = `src/plugin-sdk/${fileName}`;
    const entries = byFile.get(relFile);
    if (!entries || entries.length === 0) {
      continue;
    }

    entries.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const rows: string[][] = entries.map((e) => [`\`${e.symbol}\``, e.kind]);

    parts.push(`### \`${relFile}\` (${entries.length} exports)\n`);
    parts.push(mdTable(["Symbol", "Kind"], rows));
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

async function generateArchitecture(root: string): Promise<string> {
  const sections = await Promise.all([
    generateHeader(root),
    generateSystemOverview(root),
    generateComponentMap(root),
    generateArchitectureBoundaries(root),
    generateBoundaryViolations(root),
    generateDataFlow(root),
    generatePluginSdkSurface(root),
    generateSdkExportedSymbols(root),
    generateErrorCatalog(root),
    generatePluginProviderMap(root),
    generateTechStack(root),
    generateBuildPipeline(root),
    generateTestSurfaces(root),
    generateGeneratedArtifacts(root),
  ]);
  return sections.join("\n\n---\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const generated = await generateArchitecture(repoRoot);

if (checkOnly) {
  let current = "";
  try {
    current = await fs.readFile(outputPath, "utf-8");
  } catch {
    // file doesn't exist yet — treat as drift
  }
  if (current === generated) {
    console.log(`OK ${rel(outputPath)}`);
    process.exit(0);
  }
  console.error(
    [
      "Architecture baseline drift detected.",
      `Expected current: ${rel(outputPath)}`,
      "Run `pnpm arch:gen` and commit the updated ARCHITECTURE.md.",
    ].join("\n"),
  );
  process.exit(1);
}

await fs.writeFile(outputPath, generated, "utf-8");
console.log(`Wrote ${rel(outputPath)}`);
