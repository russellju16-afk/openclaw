import fs from "node:fs";
import path from "node:path";

/**
 * Write content to a file atomically: write to temp file, then rename.
 * This prevents partial writes from corrupting the target file.
 * The rename is atomic on POSIX filesystems when src and dst are on the same mount.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  options?: { mode?: number; encoding?: BufferEncoding },
): Promise<void> {
  const encoding = options?.encoding ?? "utf8";
  const tmpPath = `${filePath}.tmp.${process.pid}`;

  try {
    await fs.promises.writeFile(tmpPath, content, { encoding });
    if (options?.mode !== undefined) {
      await fs.promises.chmod(tmpPath, options.mode);
    }
    await fs.promises.rename(tmpPath, filePath);
  } finally {
    // Clean up temp file if rename failed (ignore errors — it may not exist)
    await fs.promises.unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * Ensure the parent directory exists, then write atomically.
 */
export async function atomicWriteFileEnsureDir(
  filePath: string,
  content: string,
  options?: { mode?: number; encoding?: BufferEncoding },
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, content, options);
}
