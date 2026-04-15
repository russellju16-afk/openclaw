#!/opt/homebrew/bin/node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function runOrEmpty(command, args = []) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function parseVmStat(text) {
  const lines = text.split("\n");
  const pageSizeMatch = lines[0]?.match(/page size of (\d+) bytes/i);
  const pageSize = Number(pageSizeMatch?.[1] ?? 16384);
  const pages = {};
  for (const line of lines.slice(1)) {
    const match = line.match(/^([^:]+):\s+([\d.]+)\.?$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLowerCase().replaceAll(/\s+/g, "_");
    pages[key] = Number(match[2]);
  }
  return { pageSize, pages };
}

function parseMemoryPressure(text) {
  const freePctMatch = text.match(/System-wide memory free percentage:\s+(\d+)%/i);
  return {
    freePercentage: freePctMatch ? Number(freePctMatch[1]) : null,
  };
}

function parseLoadAvg(text) {
  const match = text.match(/\{\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\}/);
  if (!match) {
    return null;
  }
  return {
    one: Number(match[1]),
    five: Number(match[2]),
    fifteen: Number(match[3]),
  };
}

function parseTopCpu(text) {
  const match = text.match(/CPU usage:\s+([0-9.]+)% user,\s+([0-9.]+)% sys,\s+([0-9.]+)% idle/i);
  if (!match) {
    return null;
  }
  return {
    user: Number(match[1]),
    sys: Number(match[2]),
    idle: Number(match[3]),
  };
}

function parsePsTable(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }
  return lines
    .slice(1)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        cpu: Number(match[2]),
        memPercent: Number(match[3]),
        rssKb: Number(match[4]),
        command: match[5],
      };
    })
    .filter(Boolean);
}

function readTopProcesses(sortKey) {
  const text = run("sh", ["-lc", `ps -Ao pid,pcpu,pmem,rss,comm | sort -nrk${sortKey} | head -11`]);
  return parsePsTable(text);
}

function readGatewayProcesses() {
  const text = runOrEmpty("sh", [
    "-lc",
    "ps -Ao pid,pcpu,pmem,rss,comm,args | rg 'openclaw-gateway' || true",
  ]);
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        cpu: Number(match[2]),
        memPercent: Number(match[3]),
        rssKb: Number(match[4]),
        command: match[5],
        args: match[6],
      };
    })
    .filter(Boolean);
}

function sample() {
  const vm = parseVmStat(run("vm_stat"));
  const memoryPressure = parseMemoryPressure(runOrEmpty("memory_pressure", ["-Q"]));
  const loadAvg = parseLoadAvg(run("sysctl", ["-n", "vm.loadavg"]));
  const topCpu = parseTopCpu(run("sh", ["-lc", "top -l 1 -n 0 | head -10"]));
  const memSize = Number(run("sysctl", ["-n", "hw.memsize"]));

  const freeBytes = (vm.pages.pages_free ?? 0) * vm.pageSize;
  const activeBytes = (vm.pages.pages_active ?? 0) * vm.pageSize;
  const inactiveBytes = (vm.pages.pages_inactive ?? 0) * vm.pageSize;
  const wiredBytes = (vm.pages.pages_wired_down ?? 0) * vm.pageSize;
  const compressedBytes = (vm.pages.pages_occupied_by_compressor ?? 0) * vm.pageSize;

  return {
    timestamp: new Date().toISOString(),
    host: os.hostname(),
    cpu: {
      logical: Number(run("sysctl", ["-n", "hw.logicalcpu"])),
      physical: Number(run("sysctl", ["-n", "hw.ncpu"])),
      usage: topCpu,
      loadAvg,
    },
    memory: {
      totalBytes: memSize,
      freeBytes,
      activeBytes,
      inactiveBytes,
      wiredBytes,
      compressedBytes,
      freePercentage: memoryPressure.freePercentage,
    },
    gateway: readGatewayProcesses(),
    topByCpu: readTopProcesses(2),
    topByRss: readTopProcesses(4),
  };
}

function appendSample(filePath) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(sample())}\n`, "utf8");
  process.stdout.write(`${resolved}\n`);
}

function summarize(filePath, minutes = 60) {
  const resolved = path.resolve(filePath);
  const text = fs.readFileSync(resolved, "utf8");
  const cutoff = Date.now() - minutes * 60_000;
  const rows = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => Date.parse(row.timestamp) >= cutoff);

  const summary = {
    samples: rows.length,
    windowMinutes: minutes,
    from: rows[0]?.timestamp ?? null,
    to: rows.at(-1)?.timestamp ?? null,
    cpu: {
      maxLoadAvg1: rows.reduce((max, row) => Math.max(max, row.cpu?.loadAvg?.one ?? 0), 0),
      avgIdle:
        rows.length > 0
          ? rows.reduce((sum, row) => sum + (row.cpu?.usage?.idle ?? 0), 0) / rows.length
          : null,
      minIdle:
        rows.length > 0
          ? rows.reduce((min, row) => Math.min(min, row.cpu?.usage?.idle ?? 100), 100)
          : null,
    },
    memory: {
      minFreePercentage:
        rows.length > 0
          ? rows.reduce((min, row) => {
              const value = row.memory?.freePercentage;
              return typeof value === "number" ? Math.min(min, value) : min;
            }, 100)
          : null,
      maxCompressedGb:
        rows.length > 0
          ? rows.reduce(
              (max, row) => Math.max(max, (row.memory?.compressedBytes ?? 0) / 1024 / 1024 / 1024),
              0,
            )
          : null,
    },
    gateway: {
      maxCpu:
        rows.length > 0
          ? rows.reduce(
              (max, row) =>
                Math.max(
                  max,
                  ...(Array.isArray(row.gateway) ? row.gateway.map((proc) => proc.cpu ?? 0) : [0]),
                ),
              0,
            )
          : null,
      maxRssMb:
        rows.length > 0
          ? rows.reduce(
              (max, row) =>
                Math.max(
                  max,
                  ...(Array.isArray(row.gateway)
                    ? row.gateway.map((proc) => (proc.rssKb ?? 0) / 1024)
                    : [0]),
                ),
              0,
            )
          : null,
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);

if (command === "sample") {
  process.stdout.write(`${JSON.stringify(sample(), null, 2)}\n`);
} else if (command === "append") {
  appendSample(
    args[0] ??
      path.join(process.env.HOME ?? ".", ".openclaw", "monitoring", "activity-monitor.jsonl"),
  );
} else if (command === "summary") {
  summarize(
    args[0] ??
      path.join(process.env.HOME ?? ".", ".openclaw", "monitoring", "activity-monitor.jsonl"),
    Number(args[1] ?? 60),
  );
} else {
  process.stderr.write("Usage: activity-monitor.mjs <sample|append|summary> [file] [minutes]\n");
  process.exitCode = 1;
}
