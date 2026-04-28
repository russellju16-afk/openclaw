export type FeishuTaskProgressStatus =
  | "queued"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "canceled";

export type FeishuTaskProgressStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type FeishuTaskProgressMetric = {
  label: string;
  value: string;
};

export type FeishuTaskProgressStep = {
  title: string;
  status?: FeishuTaskProgressStepStatus;
  detail?: string;
};

export type FeishuTaskProgressLink = {
  label: string;
  url: string;
  type?: "default" | "primary" | "danger";
};

export type FeishuLongTaskProgressCardParams = {
  title: string;
  taskId?: string;
  status?: FeishuTaskProgressStatus;
  percent?: number;
  summary?: string;
  updatedAt?: string;
  elapsed?: string;
  metrics?: FeishuTaskProgressMetric[];
  steps?: FeishuTaskProgressStep[];
  links?: FeishuTaskProgressLink[];
};

const STATUS_META: Record<
  FeishuTaskProgressStatus,
  { label: string; headerTemplate: string; tagColor: string }
> = {
  queued: { label: "排队中", headerTemplate: "grey", tagColor: "grey" },
  running: { label: "进行中", headerTemplate: "blue", tagColor: "blue" },
  blocked: { label: "有卡点", headerTemplate: "orange", tagColor: "orange" },
  succeeded: { label: "已完成", headerTemplate: "green", tagColor: "green" },
  failed: { label: "失败", headerTemplate: "red", tagColor: "red" },
  canceled: { label: "已取消", headerTemplate: "grey", tagColor: "grey" },
};

const STEP_LABELS: Record<FeishuTaskProgressStepStatus, string> = {
  pending: "待处理",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFirstString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/%$/, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseTaskStatus(value: unknown): FeishuTaskProgressStatus | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "success" || normalized === "done" || normalized === "complete") {
    return "succeeded";
  }
  if (normalized === "cancelled" || normalized === "cancel") {
    return "canceled";
  }
  if (normalized === "error") {
    return "failed";
  }
  if (
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "blocked" ||
    normalized === "succeeded" ||
    normalized === "failed" ||
    normalized === "canceled"
  ) {
    return normalized;
  }
  throw new Error(`Feishu progressCard status is not supported: ${normalized}`);
}

function parseStepStatus(value: unknown): FeishuTaskProgressStepStatus | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "done" || normalized === "complete" || normalized === "success") {
    return "succeeded";
  }
  if (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "succeeded" ||
    normalized === "failed" ||
    normalized === "skipped"
  ) {
    return normalized;
  }
  throw new Error(`Feishu progressCard step status is not supported: ${normalized}`);
}

function derivePercent(params: FeishuLongTaskProgressCardParams): number | undefined {
  const explicit = clampPercent(params.percent);
  if (explicit !== undefined) {
    return explicit;
  }
  if (params.status === "succeeded") {
    return 100;
  }
  if (params.status === "queued") {
    return 0;
  }
  const steps = params.steps ?? [];
  if (steps.length === 0) {
    return undefined;
  }
  const complete = steps.filter(
    (step) => step.status === "succeeded" || step.status === "skipped",
  ).length;
  return clampPercent((complete / steps.length) * 100);
}

function buildProgressBar(percent: number | undefined): string {
  if (percent === undefined) {
    return "`[----------] 未估算`";
  }
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `\`[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${percent}%\``;
}

function buildMetricColumns(metrics: FeishuTaskProgressMetric[]): Record<string, unknown> {
  return {
    tag: "column_set",
    element_id: "cols_metrics",
    flex_mode: "flow",
    horizontal_spacing: "8px",
    columns: metrics.slice(0, 4).map((metric, index) => ({
      tag: "column",
      width: "auto",
      elements: [
        {
          tag: "markdown",
          element_id: `md_metric_${index + 1}`,
          content: `<font color='grey'>${truncateText(metric.label, 24)}</font>\n**${truncateText(
            metric.value,
            80,
          )}**`,
        },
      ],
    })),
  };
}

function buildStepMarkdown(steps: FeishuTaskProgressStep[]): Record<string, unknown> | undefined {
  if (steps.length === 0) {
    return undefined;
  }
  const visibleSteps = steps.slice(0, 8);
  const lines = visibleSteps.map((step, index) => {
    const status = step.status ?? "pending";
    const title = truncateText(step.title, 80);
    const detail = step.detail ? `\n   ${truncateText(step.detail, 160)}` : "";
    return `${index + 1}. **${STEP_LABELS[status]}** ${title}${detail}`;
  });
  if (steps.length > visibleSteps.length) {
    lines.push(`还有 ${steps.length - visibleSteps.length} 个步骤未展示`);
  }
  return {
    tag: "markdown",
    element_id: "md_steps",
    content: `**步骤**\n${lines.join("\n")}`,
  };
}

function resolveButtonType(type: FeishuTaskProgressLink["type"]): string {
  if (type === "primary") {
    return "primary_filled";
  }
  if (type === "danger") {
    return "danger";
  }
  return "default";
}

function buildLinkButtons(links: FeishuTaskProgressLink[]): Record<string, unknown> | undefined {
  const visibleLinks = links.filter((link) => link.label.trim() && link.url.trim()).slice(0, 3);
  if (visibleLinks.length === 0) {
    return undefined;
  }
  return {
    tag: "column_set",
    element_id: "cols_links",
    flex_mode: "flow",
    horizontal_spacing: "8px",
    horizontal_align: "right",
    columns: visibleLinks.map((link, index) => ({
      tag: "column",
      width: "auto",
      elements: [
        {
          tag: "button",
          element_id: `btn_link_${index + 1}`,
          text: {
            tag: "plain_text",
            content: truncateText(link.label, 20),
          },
          type: resolveButtonType(link.type),
          behaviors: [
            {
              type: "open_url",
              default_url: link.url,
              pc_url: link.url,
              ios_url: link.url,
              android_url: link.url,
            },
          ],
        },
      ],
    })),
  };
}

function normalizeMetrics(params: FeishuLongTaskProgressCardParams): FeishuTaskProgressMetric[] {
  const status = params.status ?? "running";
  const percent = derivePercent(params);
  const steps = params.steps ?? [];
  const completeSteps = steps.filter(
    (step) => step.status === "succeeded" || step.status === "skipped",
  ).length;
  const metrics: FeishuTaskProgressMetric[] = [
    { label: "状态", value: STATUS_META[status].label },
    { label: "进度", value: percent === undefined ? "未估算" : `${percent}%` },
  ];
  if (steps.length > 0) {
    metrics.push({ label: "步骤", value: `${completeSteps}/${steps.length}` });
  }
  if (params.elapsed) {
    metrics.push({ label: "耗时", value: params.elapsed });
  } else if (params.updatedAt) {
    metrics.push({ label: "更新", value: params.updatedAt });
  }
  return [...metrics, ...(params.metrics ?? [])];
}

export function createLongTaskProgressCard(
  params: FeishuLongTaskProgressCardParams,
): Record<string, unknown> {
  const title = truncateText(params.title, 60);
  if (!title) {
    throw new Error("Feishu progress card requires title.");
  }
  const status = params.status ?? "running";
  const statusMeta = STATUS_META[status];
  const percent = derivePercent({ ...params, status });
  const bodyElements: Record<string, unknown>[] = [];

  if (params.summary) {
    bodyElements.push({
      tag: "markdown",
      element_id: "md_summary",
      content: truncateText(params.summary, 800),
    });
  }

  bodyElements.push({
    tag: "markdown",
    element_id: "md_progress",
    content: `**进度**\n${buildProgressBar(percent)}`,
  });
  bodyElements.push(buildMetricColumns(normalizeMetrics({ ...params, status })));

  const stepBlock = buildStepMarkdown(params.steps ?? []);
  if (stepBlock) {
    bodyElements.push({ tag: "hr", element_id: "hr_steps" });
    bodyElements.push(stepBlock);
  }

  const linkBlock = buildLinkButtons(params.links ?? []);
  if (linkBlock) {
    bodyElements.push({ tag: "hr", element_id: "hr_links" });
    bodyElements.push(linkBlock);
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill",
      summary: {
        content: `${title}: ${statusMeta.label}${percent === undefined ? "" : ` ${percent}%`}`,
      },
    },
    header: {
      template: statusMeta.headerTemplate,
      title: {
        tag: "plain_text",
        content: title,
      },
      ...(params.taskId
        ? {
            subtitle: {
              tag: "plain_text",
              content: truncateText(params.taskId, 80),
            },
          }
        : {}),
      text_tag_list: [
        {
          tag: "text_tag",
          element_id: "tag_status",
          text: {
            tag: "plain_text",
            content: statusMeta.label,
          },
          color: statusMeta.tagColor,
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px",
      vertical_spacing: "8px",
      elements: bodyElements,
    },
  };
}

function parseMetrics(value: unknown): FeishuTaskProgressMetric[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter(isRecord)
    .map((entry) => {
      const label = readFirstString(entry, ["label", "name"]);
      const rawValue = readFirstString(entry, ["value", "text"]);
      if (!label || !rawValue) {
        return null;
      }
      return { label, value: rawValue };
    })
    .filter((entry): entry is FeishuTaskProgressMetric => entry !== null);
}

function parseSteps(value: unknown): FeishuTaskProgressStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const steps: FeishuTaskProgressStep[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = readFirstString(entry, ["title", "name", "label"]);
    if (!title) {
      continue;
    }
    const status = parseStepStatus(entry.status);
    const detail = readFirstString(entry, ["detail", "description", "summary"]);
    steps.push({
      title,
      ...(status ? { status } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return steps;
}

function parseLinks(value: unknown): FeishuTaskProgressLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const links: FeishuTaskProgressLink[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const label = readFirstString(entry, ["label", "text", "title"]);
    const url = readFirstString(entry, ["url", "href", "link"]);
    if (!label || !url) {
      continue;
    }
    const type = readString(entry.type);
    links.push({
      label,
      url,
      type: type === "primary" || type === "danger" ? type : "default",
    });
  }
  return links;
}

export function resolveFeishuLongTaskProgressCardPayload(
  params: Record<string, unknown>,
): FeishuLongTaskProgressCardParams | undefined {
  const raw = [params.progressCard, params.taskProgressCard, params.longTaskProgressCard].find(
    isRecord,
  );
  if (!raw) {
    return undefined;
  }
  const title = readFirstString(raw, ["title", "task", "name"]);
  if (!title) {
    throw new Error("Feishu progressCard requires title.");
  }
  return {
    title,
    taskId: readFirstString(raw, ["taskId", "task_id", "runId", "run_id"]),
    status: parseTaskStatus(raw.status),
    percent: clampPercent(readNumber(raw.percent ?? raw.progress ?? raw.progressPercent)),
    summary: readFirstString(raw, ["summary", "description", "message"]),
    updatedAt: readFirstString(raw, ["updatedAt", "updated_at"]),
    elapsed: readFirstString(raw, ["elapsed", "duration"]),
    metrics: parseMetrics(raw.metrics),
    steps: parseSteps(raw.steps),
    links: parseLinks(raw.links ?? raw.actions),
  };
}

export function summarizeFeishuLongTaskProgressCard(params: FeishuLongTaskProgressCardParams): {
  title: string;
  taskId?: string;
  status: FeishuTaskProgressStatus;
  percent?: number;
  stepCount: number;
} {
  const status = params.status ?? "running";
  return {
    title: params.title,
    taskId: params.taskId,
    status,
    percent: derivePercent({ ...params, status }),
    stepCount: params.steps?.length ?? 0,
  };
}
