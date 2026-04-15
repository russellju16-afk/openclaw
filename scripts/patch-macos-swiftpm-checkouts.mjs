#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const checkoutsRootArg = process.argv[2];

if (!checkoutsRootArg) {
  console.error("usage: node scripts/patch-macos-swiftpm-checkouts.mjs <checkouts-root>");
  process.exit(1);
}

const checkoutsRoot = path.resolve(checkoutsRootArg);

/**
 * Patch SwiftPM checkouts so macOS companion builds still work on machines that only
 * have Command Line Tools. Those environments do not ship the SwiftUI macro plugins
 * used by newer third-party packages (`@Entry`, `#Preview`, `@Previewable`).
 */

function walkSwiftFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSwiftFiles(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith(".swift")) {
      files.push(abs);
    }
  }
  return files;
}

function inferPropertyType(name, explicitType, defaultExpr) {
  if (explicitType?.trim()) {
    return explicitType.trim();
  }
  const expr = defaultExpr.trim();
  if (expr === "true" || expr === "false") {
    return "Bool";
  }
  if (/^[A-Za-z_][A-Za-z0-9_<>.:]*\s*\(/.test(expr)) {
    return expr.replace(/\s*\(.*/, "").trim();
  }
  if (/^[A-Za-z_][A-Za-z0-9_<>.:]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(expr)) {
    return expr.replace(/\.[A-Za-z_][A-Za-z0-9_]*$/, "").trim();
  }
  throw new Error(`unable to infer EnvironmentValues property type for "${name}" from "${expr}"`);
}

function upperFirst(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function transformEnvironmentValuesExtensions(source, filePath) {
  const lines = source.split("\n");
  const out = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("extension EnvironmentValues {")) {
      out.push(line);
      continue;
    }

    const blockLines = [line];
    let braceDepth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    while (braceDepth > 0 && index + 1 < lines.length) {
      index += 1;
      const next = lines[index];
      blockLines.push(next);
      braceDepth += (next.match(/\{/g) ?? []).length - (next.match(/\}/g) ?? []).length;
    }

    const blockText = blockLines.join("\n");
    if (!blockText.includes("@Entry")) {
      out.push(blockText);
      continue;
    }

    const opening = blockLines[0];
    const closing = blockLines[blockLines.length - 1];
    const bodyLines = blockLines.slice(1, -1);
    const generatedKeys = [];
    const generatedProps = [];
    let pendingComments = [];
    let pendingAttrs = [];

    const flushUnexpected = () => {
      throw new Error(`unsupported @Entry block shape in ${filePath}`);
    };

    for (const bodyLine of bodyLines) {
      const trimmed = bodyLine.trim();
      if (!trimmed) {
        if (pendingComments.length || pendingAttrs.length) {
          pendingComments.push(bodyLine);
        }
        continue;
      }
      if (trimmed.startsWith("///") || trimmed.startsWith("//")) {
        pendingComments.push(bodyLine);
        continue;
      }
      if (trimmed.startsWith("@") && !trimmed.startsWith("@Entry")) {
        pendingAttrs.push(bodyLine);
        continue;
      }
      if (!trimmed.startsWith("@Entry")) {
        flushUnexpected();
      }

      const indent = bodyLine.match(/^\s*/)?.[0] ?? "";
      const entryMatch = trimmed.match(
        /^@Entry\s+var\s+([A-Za-z_][A-Za-z0-9_]*)(?::\s*(.+?))?\s*=\s*(.+)$/,
      );
      if (!entryMatch) {
        flushUnexpected();
      }
      const [, name, explicitType, defaultExpr] = entryMatch;
      const propertyType = inferPropertyType(name, explicitType, defaultExpr);
      const keyName = `__OpenClawPatched${upperFirst(name)}EnvironmentKey`;

      generatedKeys.push(
        [
          `${indent}private enum ${keyName}: EnvironmentKey {`,
          `${indent}  nonisolated(unsafe) static let defaultValue: ${propertyType} = ${defaultExpr.trim()}`,
          `${indent}}`,
        ].join("\n"),
      );

      const propLines = [];
      if (pendingComments.length > 0) {
        propLines.push(...pendingComments);
      }
      if (pendingAttrs.length > 0) {
        propLines.push(...pendingAttrs);
      }
      propLines.push(
        `${indent}var ${name}: ${propertyType} {`,
        `${indent}  get { self[${keyName}.self] }`,
        `${indent}  set { self[${keyName}.self] = newValue }`,
        `${indent}}`,
      );
      generatedProps.push(propLines.join("\n"));
      pendingComments = [];
      pendingAttrs = [];
    }

    if (pendingComments.length || pendingAttrs.length) {
      flushUnexpected();
    }

    out.push(generatedKeys.join("\n\n"));
    out.push("");
    out.push(opening);
    out.push(generatedProps.join("\n\n"));
    out.push(closing);
  }

  return out.join("\n");
}

function stripPreviewBlocks(source) {
  const attributedPreviewMatch = source.match(
    /\n(?:@available[^\n]*\n)+(?:\s*\n)?#Preview[\s\S]*$/m,
  );
  if (attributedPreviewMatch?.index !== undefined) {
    return source.slice(0, attributedPreviewMatch.index).trimEnd() + "\n";
  }
  const previewMatch = source.match(/\n#Preview[\s\S]*$/m);
  if (previewMatch?.index !== undefined) {
    return source.slice(0, previewMatch.index).trimEnd() + "\n";
  }
  return source;
}

function patchSwiftFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let next = original;
  next = transformEnvironmentValuesExtensions(next, filePath);
  next = stripPreviewBlocks(next);
  if (next !== original) {
    const stat = fs.statSync(filePath);
    if ((stat.mode & 0o200) === 0) {
      fs.chmodSync(filePath, stat.mode | 0o200);
    }
    fs.writeFileSync(filePath, next, "utf8");
    return true;
  }
  return false;
}

const targetRoots = [
  path.join(checkoutsRoot, "swiftui-math", "Sources", "SwiftUIMath"),
  path.join(checkoutsRoot, "textual", "Sources", "Textual"),
];

let patchedCount = 0;
for (const targetRoot of targetRoots) {
  for (const filePath of walkSwiftFiles(targetRoot)) {
    if (patchSwiftFile(filePath)) {
      patchedCount += 1;
    }
  }
}

console.log(
  `[patch-macos-swiftpm-checkouts] patched ${patchedCount} file(s) under ${checkoutsRoot}`,
);
