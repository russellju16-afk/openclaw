import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export function resolveEnterpriseDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ENTERPRISE_DB?.trim();
  if (explicit) {
    return explicit;
  }

  const dataDb = path.join(os.homedir(), "data", "enterprise.db");
  if (existsSync(dataDb)) {
    return dataDb;
  }

  return path.join(resolveStateDir(env), "customers", "enterprise.db");
}
