import { describe, expect, it } from "vitest";
import {
  createLongTaskProgressCard,
  resolveFeishuLongTaskProgressCardPayload,
  summarizeFeishuLongTaskProgressCard,
} from "./card-ux-progress.js";

function findElement(card: Record<string, unknown>, elementId: string): Record<string, unknown> {
  const body = card.body as { elements: Record<string, unknown>[] };
  const found = body.elements.find((element) => element.element_id === elementId);
  expect(found).toBeDefined();
  return found!;
}

describe("Feishu long task progress card", () => {
  it("builds a CardKit 2.0 progress card for people", () => {
    const card = createLongTaskProgressCard({
      title: "生成供应商对账单",
      taskId: "run_123",
      status: "running",
      percent: 45,
      summary: "正在拉取金蝶和本地单据，完成后会给出差异清单。",
      elapsed: "2 分钟",
      metrics: [{ label: "单据", value: "128" }],
      steps: [
        { title: "读取供应商档案", status: "succeeded" },
        { title: "拉取金蝶余额", status: "running", detail: "正在等待接口返回" },
        { title: "生成 Excel", status: "pending" },
      ],
      links: [{ label: "查看任务", url: "https://example.com/tasks/run_123", type: "primary" }],
    });

    expect(card).toMatchObject({
      schema: "2.0",
      config: expect.objectContaining({
        update_multi: true,
        width_mode: "fill",
      }),
      header: expect.objectContaining({
        template: "blue",
        subtitle: expect.objectContaining({ content: "run_123" }),
      }),
    });
    expect(card).not.toHaveProperty("elements");
    expect(JSON.stringify(card)).not.toContain('"tag":"action"');

    const progress = findElement(card, "md_progress") as { content: string };
    expect(progress.content).toContain("[#####-----] 45%");

    const steps = findElement(card, "md_steps") as { content: string };
    expect(steps.content).toContain("**已完成** 读取供应商档案");
    expect(steps.content).toContain("**进行中** 拉取金蝶余额");

    const links = findElement(card, "cols_links") as {
      columns: Array<{ elements: Array<{ behaviors?: Array<{ type: string }> }> }>;
    };
    expect(links.columns[0]?.elements[0]?.behaviors).toEqual([
      expect.objectContaining({ type: "open_url" }),
    ]);
  });

  it("normalizes structured progressCard payloads", () => {
    const params = resolveFeishuLongTaskProgressCardPayload({
      progressCard: {
        title: "开票批处理",
        run_id: "invoice_1",
        status: "done",
        progress: "100%",
        steps: [{ name: "提交税务系统", status: "success" }],
        actions: [{ text: "打开结果", href: "https://example.com/result" }],
      },
    });

    expect(params).toMatchObject({
      title: "开票批处理",
      taskId: "invoice_1",
      status: "succeeded",
      percent: 100,
      steps: [{ title: "提交税务系统", status: "succeeded" }],
      links: [{ label: "打开结果", url: "https://example.com/result" }],
    });
  });

  it("summarizes machine-readable task state without exposing card JSON", () => {
    const summary = summarizeFeishuLongTaskProgressCard({
      title: "采购数据刷新",
      status: "running",
      steps: [
        { title: "下载", status: "succeeded" },
        { title: "清洗", status: "running" },
      ],
    });

    expect(summary).toEqual({
      title: "采购数据刷新",
      status: "running",
      percent: 50,
      stepCount: 2,
    });
  });

  it("rejects unsupported task states", () => {
    expect(() =>
      resolveFeishuLongTaskProgressCardPayload({
        progressCard: {
          title: "坏状态",
          status: "almost_done",
        },
      }),
    ).toThrow("Feishu progressCard status is not supported");
  });
});
