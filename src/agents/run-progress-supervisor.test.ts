import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { createRunProgressSupervisor } from "./run-progress-supervisor.js";

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    config: { channels: { feishu: { enabled: true } } } as OpenClawConfig,
    runId: "run-1",
    sessionId: "session-1",
    sessionKey: "agent:laicai:main",
    agentId: "laicai",
    messageProvider: "feishu",
    messageTo: "chat:oc_group_1",
    agentAccountId: "laicai",
    trigger: "user",
    ...overrides,
  };
}

function createHarness() {
  let timerCallback: (() => void) | undefined;
  let currentNow = 0;
  const clearTimeoutMock = vi.fn();
  const sendAction = vi.fn(async (input: { action: string; params: Record<string, unknown> }) => {
    if (input.action === "send") {
      return {
        kind: "send",
        channel: "feishu",
        action: "send",
        to: input.params.to,
        handledBy: "plugin",
        payload: { ok: true, messageId: "om_progress_1" },
        dryRun: false,
      };
    }
    return {
      kind: "action",
      channel: "feishu",
      action: input.action,
      handledBy: "plugin",
      payload: { ok: true, messageId: input.params.messageId },
      dryRun: false,
    };
  });
  return {
    sendAction,
    clearTimeoutMock,
    advance(ms: number) {
      currentNow += ms;
    },
    fireTimer() {
      timerCallback?.();
    },
    deps: {
      now: () => currentNow,
      setTimeout: (callback: () => void) => {
        timerCallback = callback;
        return "timer-1";
      },
      clearTimeout: clearTimeoutMock,
      sendAction: sendAction as never,
    },
  };
}

describe("run progress supervisor", () => {
  it("does nothing outside Feishu delivery runs", async () => {
    const harness = createHarness();
    const supervisor = createRunProgressSupervisor(
      baseParams({
        messageProvider: "slack",
        deps: harness.deps,
      }),
    );

    supervisor.onAgentEvent({ stream: "tool", data: { phase: "start", name: "bash" } });
    harness.fireTimer();
    await supervisor.finish({ success: true, durationMs: 20_000 });

    expect(harness.sendAction).not.toHaveBeenCalled();
    expect(harness.clearTimeoutMock).not.toHaveBeenCalled();
  });

  it("sends a progress card after the delay and finalizes it", async () => {
    const harness = createHarness();
    const supervisor = createRunProgressSupervisor(baseParams({ deps: harness.deps }));

    harness.advance(16_000);
    harness.fireTimer();
    await supervisor.finish({ success: true, durationMs: 16_000 });

    expect(harness.sendAction).toHaveBeenCalledTimes(2);
    expect(harness.sendAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "send",
        params: expect.objectContaining({
          channel: "feishu",
          to: "chat:oc_group_1",
          accountId: "laicai",
          progressCard: expect.objectContaining({
            status: "running",
            taskId: "run-1",
          }),
        }),
      }),
    );
    expect(harness.sendAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "edit",
        params: expect.objectContaining({
          messageId: "om_progress_1",
          progressCard: expect.objectContaining({
            status: "succeeded",
          }),
        }),
      }),
    );
  });

  it("keeps tool progress in the card state without model participation", async () => {
    const harness = createHarness();
    const supervisor = createRunProgressSupervisor(baseParams({ deps: harness.deps }));

    supervisor.onAgentEvent({
      stream: "tool",
      data: { phase: "start", name: "query_inventory", toolCallId: "tc-1" },
    });
    supervisor.onAgentEvent({
      stream: "tool",
      data: { phase: "result", name: "query_inventory", toolCallId: "tc-1" },
    });
    harness.advance(18_000);
    harness.fireTimer();
    await supervisor.finish({ success: true, durationMs: 18_000 });

    const firstCard = harness.sendAction.mock.calls[0]?.[0].params.progressCard as {
      steps?: Array<{ title: string; status: string }>;
      metrics?: Array<{ label: string; value: string }>;
    };
    expect(firstCard.steps).toEqual([
      expect.objectContaining({
        title: "执行 query inventory",
        status: "succeeded",
      }),
    ]);
    expect(firstCard.metrics).toContainEqual({ label: "工具调用", value: "1" });
  });

  it("cancels the delayed card when the assistant starts replying first", async () => {
    const harness = createHarness();
    const supervisor = createRunProgressSupervisor(baseParams({ deps: harness.deps }));

    supervisor.onAssistantMessageStart();
    harness.advance(16_000);
    harness.fireTimer();
    await supervisor.finish({ success: true, durationMs: 16_000 });

    expect(harness.clearTimeoutMock).toHaveBeenCalledWith("timer-1");
    expect(harness.sendAction).not.toHaveBeenCalled();
  });
});
