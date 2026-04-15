import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildProductImageFileName,
  classifyUsageRole,
  inferExternalReady,
  normalizeDirection,
  normalizeImageTypeLabel,
} from "/Users/mac/data/tools/mcp-server/lib/product-image-rules.mjs";

type Candidate = {
  sourcePath: string;
  sourceRelPath: string;
  category: string | null;
  brand: string | null;
  productName: string | null;
  productSpec: string | null;
  direction: string | null;
  imageType: string | null;
  source: string;
  widthPx: number | null;
  heightPx: number | null;
  sizeBytes: number;
  clarityLevel: "high" | "medium" | "low";
  visionUsed: boolean;
  visionError: string | null;
};

type VisionConfig =
  | {
      enabled: true;
      apiKey: string;
      host: string;
      provider: "minimax" | "minimax-portal";
      model: "MiniMax-VL-01";
    }
  | {
      enabled: false;
      reason: string;
    };

const HOME = os.homedir();
const FILES_ROOT = path.join(HOME, "data", "files");
const PRODUCT_IMAGES_ROOT = path.join(FILES_ROOT, "product-images");
const QUALITY_REPORTS_ROOT = path.join(FILES_ROOT, "quality-reports");
const REPORT_WORDS_RE = /检验报告|出厂检验报告|成品检验报告/;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SPEC_RE = /(\d+(?:\.\d+)?\s*(?:L|l|KG|kg|Kg|g|G|ML|ml|斤))/;

function compact(value: unknown): string {
  return (typeof value === "string" ? value : value == null ? "" : JSON.stringify(value))
    .replace(/\s+/g, "")
    .trim();
}

function stripKnownSuffixes(text: string): string {
  return compact(
    text
      .replace(/批次\d{4}-\d{2}-\d{2}/g, "")
      .replace(/批次报告/g, "")
      .replace(/_\d{2,}$/g, ""),
  );
}

function splitProductNameAndSpec(text: string): {
  productName: string | null;
  productSpec: string | null;
} {
  const raw = compact(text);
  if (!raw) {
    return { productName: null, productSpec: null };
  }
  const match = raw.match(SPEC_RE);
  if (!match) {
    return { productName: raw, productSpec: null };
  }
  const spec = compact(match[1]);
  return {
    productName: compact(raw.replace(spec, "")) || raw,
    productSpec: spec,
  };
}

function inferCategory(productName: string | null): string | null {
  const text = compact(productName);
  if (!text) {
    return null;
  }
  if (text.includes("油")) {
    return "食用油";
  }
  if (text.includes("米")) {
    return "大米";
  }
  if (text.includes("面") || text.includes("粉")) {
    return "面粉";
  }
  return null;
}

function splitBrandAndProduct(mainToken: string, knownBrands: string[]) {
  const clean = stripKnownSuffixes(mainToken);
  const sortedBrands = [...knownBrands].toSorted((a, b) => b.length - a.length);
  for (const brand of sortedBrands) {
    if (!brand) {
      continue;
    }
    if (clean.startsWith(brand)) {
      const remainder = compact(clean.slice(brand.length));
      const split = splitProductNameAndSpec(remainder || clean);
      return {
        brand,
        productName: split.productName,
        productSpec: split.productSpec,
      };
    }
  }
  const split = splitProductNameAndSpec(clean);
  return {
    brand: null,
    productName: split.productName,
    productSpec: split.productSpec,
  };
}

function inferFromFilename(filePath: string, knownBrands: string[]) {
  const stem = path.basename(filePath, path.extname(filePath));
  const parts = stem
    .split("_")
    .map((part) => compact(part))
    .filter(Boolean);
  const joined = parts.join("_");
  const direction = normalizeDirection(joined);
  const imageType = normalizeImageTypeLabel(joined);

  let brand: string | null = null;
  let productName: string | null = null;
  let productSpec: string | null = null;

  if (parts.length >= 2) {
    const mainToken = parts.find(
      (part) => !/^批次\d{4}-\d{2}-\d{2}$/.test(part) && !/^\d{2}$/.test(part) && part !== parts[0],
    );
    if (mainToken) {
      const split = splitBrandAndProduct(mainToken, knownBrands);
      brand = split.brand;
      productName = split.productName;
      productSpec = split.productSpec;
    }
  } else if (parts.length === 1) {
    const split = splitProductNameAndSpec(stripKnownSuffixes(parts[0]));
    productName = split.productName;
    productSpec = split.productSpec;
  }

  if (brand && ["批次报告", "批次"].includes(brand)) {
    brand = null;
  }
  if (productName && REPORT_WORDS_RE.test(productName)) {
    productName = null;
  }

  return {
    brand,
    productName,
    productSpec,
    direction,
    imageType,
    category: inferCategory(productName),
  };
}

function readImageSize(filePath: string): { widthPx: number | null; heightPx: number | null } {
  try {
    const out = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const widthMatch = out.match(/pixelWidth:\s+(\d+)/);
    const heightMatch = out.match(/pixelHeight:\s+(\d+)/);
    return {
      widthPx: widthMatch ? Number(widthMatch[1]) : null,
      heightPx: heightMatch ? Number(heightMatch[1]) : null,
    };
  } catch {
    return { widthPx: null, heightPx: null };
  }
}

function inferClarityLevel(
  widthPx: number | null,
  heightPx: number | null,
  sizeBytes: number,
): "high" | "medium" | "low" {
  const minDim = Math.min(widthPx ?? 0, heightPx ?? 0);
  if (minDim >= 1800 && sizeBytes >= 120 * 1024) {
    return "high";
  }
  if (minDim >= 900 && sizeBytes >= 25 * 1024) {
    return "medium";
  }
  return "low";
}

function loadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveVisionConfig(): VisionConfig {
  const globalConfigPath = path.join(HOME, ".openclaw", "openclaw.json");
  const mainModelsPath = path.join(HOME, ".openclaw", "agents", "main", "agent", "models.json");
  const mainAuthPath = path.join(
    HOME,
    ".openclaw",
    "agents",
    "main",
    "agent",
    "auth-profiles.json",
  );
  const globalConfig = fs.existsSync(globalConfigPath) ? loadJson(globalConfigPath) : {};
  const models = fs.existsSync(mainModelsPath) ? loadJson(mainModelsPath) : {};
  const providers = models.providers ?? {};
  const minimaxProvider = providers.minimax;
  const minimaxPortalProvider = providers["minimax-portal"];
  const globalProviders = globalConfig?.models?.providers ?? {};

  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (apiKey) {
    return {
      enabled: true,
      apiKey,
      host: String(minimaxProvider?.baseUrl || "https://api.minimax.io/anthropic"),
      provider: "minimax",
      model: "MiniMax-VL-01",
    };
  }

  const portalKey = compact(globalProviders?.["minimax-portal"]?.apiKey);
  if (portalKey) {
    return {
      enabled: true,
      apiKey: portalKey,
      host: String(
        globalProviders?.["minimax-portal"]?.baseUrl ||
          minimaxPortalProvider?.baseUrl ||
          "https://api.minimaxi.com/anthropic",
      ),
      provider: "minimax-portal",
      model: "MiniMax-VL-01",
    };
  }

  if (fs.existsSync(mainAuthPath)) {
    const authStore = loadJson(mainAuthPath);
    const access = authStore?.profiles?.["minimax-portal:default"]?.access;
    if (typeof access === "string" && access.trim()) {
      return {
        enabled: true,
        apiKey: access.trim(),
        host: String(minimaxPortalProvider?.baseUrl || "https://api.minimaxi.com/anthropic"),
        provider: "minimax-portal",
        model: "MiniMax-VL-01",
      };
    }
  }

  return { enabled: false, reason: "未配置可用的 MiniMax API key 或 minimax-portal access token" };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function coerceMinimaxHost(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    try {
      return new URL(`https://${raw}`).origin;
    } catch {
      return "https://api.minimax.io";
    }
  }
}

async function minimaxUnderstandImageLocal(params: {
  apiKey: string;
  prompt: string;
  imageDataUrl: string;
  host: string;
}) {
  const url = new URL("/v1/coding_plan/vlm", coerceMinimaxHost(params.host)).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "MM-API-Source": "OpenClaw",
    },
    body: JSON.stringify({
      prompt: params.prompt,
      image_url: params.imageDataUrl,
    }),
  });

  const traceId = res.headers.get("Trace-Id") ?? "";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `MiniMax VLM request failed (${res.status} ${res.statusText})${traceId ? ` Trace-Id: ${traceId}` : ""}${
        body ? ` Body: ${body.slice(0, 400)}` : ""
      }`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  const baseResp =
    typeof json.base_resp === "object" && json.base_resp
      ? (json.base_resp as Record<string, unknown>)
      : {};
  const code = typeof baseResp.status_code === "number" ? baseResp.status_code : -1;
  if (code !== 0) {
    const message = typeof baseResp.status_msg === "string" ? baseResp.status_msg : "";
    throw new Error(
      `MiniMax VLM API error (${code})${message ? `: ${message}` : ""}${traceId ? `. Trace-Id: ${traceId}` : ""}`,
    );
  }

  const content = typeof json.content === "string" ? json.content.trim() : "";
  if (!content) {
    throw new Error(`MiniMax VLM returned no content${traceId ? `. Trace-Id: ${traceId}` : ""}`);
  }
  return content;
}

async function describeWithVision(
  filePath: string,
  vision: VisionConfig,
): Promise<Record<string, unknown> | null> {
  if (!vision.enabled) {
    return null;
  }
  const mime = path.extname(filePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  const imageDataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  const prompt = [
    "请识别这张商品图片，并且只返回一行 JSON，不要解释。",
    '字段固定为 {"brand":"","product_name":"","product_spec":"","direction":"","image_type":"","category":""}。',
    "direction 只能用：正面图、左侧图、右侧图、背面图、顶部图、底部图、斜45度图、细节图。",
    "image_type 只能用：包装图、标签细节图、箱码图、条码图、陈列图、场景图、细节图。",
  ].join("\n");
  const raw = await minimaxUnderstandImageLocal({
    apiKey: vision.apiKey,
    prompt,
    imageDataUrl,
    host: vision.host,
  });
  return extractJsonObject(raw);
}

function mergeMetadata(
  filenameMeta: ReturnType<typeof inferFromFilename>,
  visionMeta: Record<string, unknown> | null,
) {
  const visionBrand = compact(visionMeta?.brand);
  let visionProductName = compact(visionMeta?.product_name);
  if (visionBrand && visionProductName.startsWith(visionBrand)) {
    visionProductName = compact(visionProductName.slice(visionBrand.length));
  }
  const merged = {
    brand: visionBrand || filenameMeta.brand,
    productName: visionProductName || filenameMeta.productName,
    productSpec: compact(visionMeta?.product_spec) || filenameMeta.productSpec,
    direction: normalizeDirection(visionMeta?.direction) || filenameMeta.direction || null,
    imageType: normalizeImageTypeLabel(visionMeta?.image_type) || filenameMeta.imageType || null,
    category: compact(visionMeta?.category) || filenameMeta.category,
  };
  if (!merged.category) {
    merged.category = inferCategory(merged.productName);
  }
  if (!merged.direction) {
    merged.direction = "细节图";
  }
  if (!merged.imageType) {
    merged.imageType = merged.direction === "细节图" ? "细节图" : "包装图";
  }
  return merged;
}

function walkFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    results.push(fullPath);
  }
  return results;
}

function collectCandidates(): string[] {
  const candidates = new Set<string>();
  for (const filePath of walkFiles(PRODUCT_IMAGES_ROOT)) {
    candidates.add(filePath);
  }
  for (const filePath of walkFiles(QUALITY_REPORTS_ROOT)) {
    if (!REPORT_WORDS_RE.test(path.basename(filePath))) {
      candidates.add(filePath);
    }
  }
  return Array.from(candidates).toSorted();
}

function parseKnownBrandValues(raw: string | null | undefined): string[] {
  const text = compact(raw);
  if (!text) {
    return [];
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => compact(value)).filter(Boolean);
      }
    } catch {}
  }
  return text
    .split(/[、,，/]/)
    .map((part) => compact(part))
    .filter(Boolean);
}

function loadKnownBrands(db: {
  prepare: (sql: string) => { all: () => Array<{ brand?: unknown }> };
}): string[] {
  const values = new Set<string>();
  const productBrands = db
    .prepare(
      `SELECT DISTINCT brand FROM products WHERE is_deleted = 0 AND brand IS NOT NULL AND trim(brand) <> ''`,
    )
    .all();
  for (const row of productBrands) {
    const brand = compact(row.brand);
    if (brand) {
      values.add(brand);
    }
  }

  const supplierBrands = db
    .prepare(
      `SELECT brands FROM suppliers WHERE is_deleted = 0 AND brands IS NOT NULL AND trim(brands) <> ''`,
    )
    .all();
  for (const row of supplierBrands) {
    for (const brand of parseKnownBrandValues(row.brands)) {
      values.add(brand);
    }
  }
  return Array.from(values);
}

function writeSidecar(
  targetPath: string,
  item: Candidate,
  usageRole: "primary" | "alternate" | "rejected",
  externalReady: boolean,
) {
  const sidecarPath = targetPath.replace(/\.[^.]+$/, ".md");
  const content = [
    `# ${compact(item.brand) || "未识别品牌"} ${compact(item.productName) || "未识别产品"} 产品图片`,
    "",
    `- 品类：${item.category || "未分类"}`,
    `- 品牌：${item.brand || "未识别"}`,
    `- 产品：${[item.productName, item.productSpec].filter(Boolean).join("") || "未识别"}`,
    `- 图片方向：${item.direction || "细节图"}`,
    `- 图片类型：${item.imageType || "细节图"}`,
    `- 使用分级：${usageRole}`,
    `- 对外可发：${externalReady ? "是" : "否"}`,
    `- 清晰度：${item.clarityLevel}`,
    `- 来源：${item.source}`,
    `- 入库日期：${new Date().toISOString().slice(0, 10)}`,
    item.visionUsed ? "- 识别方式：文件名 + MiniMax VL" : "- 识别方式：文件名规则",
    item.visionError ? `- 视觉识别异常：${item.visionError}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(sidecarPath, content, "utf8");
}

function appendSequenceSuffix(fileName: string, index: number): string {
  if (index <= 0) {
    return fileName;
  }
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  return `${stem}_${String(index + 1).padStart(2, "0")}${ext}`;
}

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes("--apply"),
    visionMode:
      argv.includes("--vision-mode=always") ||
      (argv.includes("--vision-mode") && argv[argv.indexOf("--vision-mode") + 1] === "always")
        ? "always"
        : "missing",
    limit: (() => {
      const inline = argv.find((arg) => arg.startsWith("--limit="));
      if (inline) {
        return Number(inline.split("=")[1]);
      }
      const idx = argv.indexOf("--limit");
      if (idx >= 0) {
        return Number(argv[idx + 1]);
      }
      return Number.POSITIVE_INFINITY;
    })(),
  } as const;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allCandidates = collectCandidates().slice(0, args.limit);
  const vision = resolveVisionConfig();
  let visionBlockedReason = !vision.enabled ? vision.reason : null;

  process.env.ENTERPRISE_MCP_SKIP_CONNECT = "1";
  const mcpModule = await import(
    pathToFileURL(path.join(HOME, "data", "tools", "mcp-server", "index.mjs")).href
  );
  const archiveModule = await import(
    pathToFileURL(
      path.join(HOME, ".openclaw", "agents", "laifu", "workspace", "shared", "archive-file.ts"),
    ).href
  );
  const db = mcpModule.openDb();

  try {
    const knownBrands = loadKnownBrands(db);
    const pending: Candidate[] = [];
    for (const filePath of allCandidates) {
      const sourceRelPath = path.relative(FILES_ROOT, filePath);
      const exists = db
        .prepare(
          `SELECT pi.id
         FROM product_images pi
         JOIN files f ON f.id = pi.file_id
         WHERE f.stored_path = ? AND pi.is_deleted = 0
         LIMIT 1`,
        )
        .get(sourceRelPath);
      if (exists) {
        continue;
      }

      const stat = fs.statSync(filePath);
      const size = readImageSize(filePath);
      const filenameMeta = inferFromFilename(filePath, knownBrands);

      let visionMeta: Record<string, unknown> | null = null;
      let visionUsed = false;
      let visionError: string | null = null;
      const needsVision =
        args.visionMode === "always" ||
        !filenameMeta.brand ||
        !filenameMeta.productName ||
        !filenameMeta.direction;

      if (needsVision && !visionBlockedReason && vision.enabled) {
        try {
          visionMeta = await describeWithVision(filePath, vision);
          visionUsed = Boolean(visionMeta);
        } catch (error) {
          visionError = error instanceof Error ? error.message : String(error);
          if (/2061|not support model|coding-plan-vlm/i.test(visionError)) {
            visionBlockedReason = visionError;
          }
        }
      }

      const merged = mergeMetadata(filenameMeta, visionMeta);
      if (
        !merged.productName ||
        (!merged.brand && /^批次报告|^\d{4}-\d{2}-\d{2}$/.test(merged.productName))
      ) {
        continue;
      }
      pending.push({
        sourcePath: filePath,
        sourceRelPath,
        category: merged.category,
        brand: merged.brand,
        productName: merged.productName,
        productSpec: merged.productSpec,
        direction: merged.direction,
        imageType: merged.imageType,
        source: sourceRelPath.startsWith("product-images/")
          ? "archive_existing"
          : "quality-reports_backfill",
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        sizeBytes: stat.size,
        clarityLevel: inferClarityLevel(size.widthPx, size.heightPx, stat.size),
        visionUsed,
        visionError,
      });
    }

    const grouped = new Map<string, Candidate[]>();
    for (const item of pending) {
      const key = [item.category, item.brand, item.productName, item.productSpec, item.direction]
        .map((value) => compact(value))
        .join("|");
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }

    const report: Array<Record<string, unknown>> = [];
    for (const items of grouped.values()) {
      items.sort((a, b) => {
        const scoreA = (a.widthPx ?? 0) * (a.heightPx ?? 0) + a.sizeBytes;
        const scoreB = (b.widthPx ?? 0) * (b.heightPx ?? 0) + b.sizeBytes;
        return scoreB - scoreA;
      });

      for (const [index, item] of items.entries()) {
        const usageRole = classifyUsageRole({
          requested_role: null,
          clarity_level: item.clarityLevel,
          is_best_candidate: index === 0,
        });
        const externalReady = inferExternalReady({
          clarity_level: item.clarityLevel,
          direction: item.direction,
          usage_role: usageRole,
        });
        const targetName = buildProductImageFileName({
          brand: item.brand || "",
          product_name: item.productName || "",
          product_spec: item.productSpec || "",
          direction: item.direction || "细节图",
          image_type: item.imageType || "细节图",
          extension: path.extname(item.sourcePath),
        });
        const finalTargetName = appendSequenceSuffix(targetName, index);
        const productLabel = [item.productName, item.productSpec].filter(Boolean).join("");
        const subDir = path.join(
          item.category || "未分类",
          item.brand || "未识别品牌",
          productLabel || "未识别产品",
        );
        const targetPath = path.join(PRODUCT_IMAGES_ROOT, subDir, finalTargetName);

        let finalPath = item.sourcePath;
        let archived = false;
        let registered = false;
        let skippedReason: string | null = null;

        if (args.apply) {
          if (path.resolve(item.sourcePath) !== path.resolve(targetPath)) {
            const archiveResult = await archiveModule.archiveFile({
              sourcePath: item.sourcePath,
              category: "product-images",
              subDir,
              targetName: finalTargetName,
            });
            if (!archiveResult.success || !archiveResult.targetPath) {
              skippedReason = archiveResult.error ?? "archive failed";
            } else {
              finalPath = archiveResult.targetPath;
              archived = true;
            }
          }
          if (!skippedReason) {
            writeSidecar(finalPath, item, usageRole, externalReady);

            const productRow = db
              .prepare(
                `SELECT id, category, brand, display_name, spec
               FROM products
               WHERE is_deleted = 0
                 AND (
                   display_name LIKE ? OR full_name LIKE ?
                 )
               ORDER BY frequency DESC, updated_at DESC
               LIMIT 1`,
              )
              .get(`%${item.productName ?? ""}%`, `%${item.productName ?? ""}%`);

            const result = mcpModule.registerProductImageRecord(db, {
              category: item.category ?? productRow?.category ?? null,
              brand: item.brand ?? productRow?.brand ?? null,
              product_id: productRow?.id ?? null,
              product_name: item.productName,
              product_spec: item.productSpec,
              direction: item.direction,
              image_type: item.imageType,
              usage_role: usageRole,
              clarity_level: item.clarityLevel,
              width_px: item.widthPx,
              height_px: item.heightPx,
              size_bytes: item.sizeBytes,
              external_ready: externalReady,
              source: item.source,
              notes: item.visionError ? `vision_error=${item.visionError}` : null,
              file_path: finalPath,
              actor: "codex-backfill",
            });
            if (result?.error) {
              skippedReason = result.error;
            } else if (result?.action === "duplicate") {
              skippedReason = `duplicate:${result.reason ?? "unknown"}`;
            } else {
              registered = true;
            }
          }
        }

        report.push({
          source_rel_path: item.sourceRelPath,
          target_rel_path: path.relative(FILES_ROOT, targetPath),
          product: [item.brand, item.productName, item.productSpec].filter(Boolean).join(" "),
          direction: item.direction,
          image_type: item.imageType,
          clarity_level: item.clarityLevel,
          usage_role: usageRole,
          external_ready: externalReady,
          vision_used: item.visionUsed,
          vision_error: item.visionError,
          archived,
          registered,
          skipped_reason: skippedReason,
        });
      }
    }

    const outputDir = path.join(process.cwd(), "output");
    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(
      outputDir,
      `backfill-product-images-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          apply: args.apply,
          vision: vision.enabled
            ? {
                provider: vision.provider,
                model: vision.model,
                blocked_reason: visionBlockedReason,
              }
            : { enabled: false, reason: vision.reason },
          candidate_count: allCandidates.length,
          processed_count: report.length,
          report,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(
      JSON.stringify(
        {
          apply: args.apply,
          candidate_count: allCandidates.length,
          processed_count: report.length,
          report_path: reportPath,
          vision: vision.enabled
            ? {
                provider: vision.provider,
                model: vision.model,
                blocked_reason: visionBlockedReason,
              }
            : { enabled: false, reason: vision.reason },
          archived_count: report.filter((row) => row.archived).length,
          registered_count: report.filter((row) => row.registered).length,
          skipped_count: report.filter((row) => row.skipped_reason).length,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

await main();
