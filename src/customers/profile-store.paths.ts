import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export function resolveCustomerStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCLAW_STATE_DIR?.trim();
  if (explicit) {
    return resolveStateDir(env);
  }
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "openclaw-test-state", String(process.pid));
  }
  return resolveStateDir(env);
}

export function resolveCustomerProfilesDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCustomerStateDir(env), "customers");
}

export function resolveCustomerProfilesSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCustomerProfilesDir(env), "profiles.sqlite");
}
