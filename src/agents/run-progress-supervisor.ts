import type { OpenClawConfig } from "../config/config.js";
import {
  runMessageAction,
  type MessageActionRunResult,
  type RunMessageActionParams,
} from "../infra/outbound/message-action-runner.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";

export type RunProgressAgentEvent = {
  stream: string;
  data: Record<string, unknown>;
};

export type RunProgressFinishParams = {
  success: boolean;
  error?: string;
  aborted?: boolean;
  durationMs?: number;
};

export type RunProgressSupervisor = {
  onAgentEvent(event: RunProgressAgentEvent): void;
  onAssistantMessageStart(): void;
  finish(params: RunProgressFinishParams): Promise<void>;
};

type ProgressStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

type ProgressStep = {
  title: string;
  status: ProgressStepStatus;
  detail?: string;
};

type RunProgressSupervisorDeps = {
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  sendAction?: (input: RunMessageActionParams) => Promise<MessageActionRunResult>;
};

export type CreateRunProgressSupervisorParams = {
  config?: OpenClawConfig;
  runId: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  messageChannel?: string;
  messageProvider?: string;
  messageTo?: string;
  agentAccountId?: string;
  trigger?: string;
  initialDelayMs?: number;
  deps?: RunProgressSupervisorDeps;
};

const log = createSubsystemLogger("agent/progress");
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const MAX_STEPS = 12;

const noopSupervisor: RunProgressSupervisor = {
  onAgentEvent: () => {},
  onAssistantMessageStart: () => {},
  finish: async () => {},
};

function isFeishuChannel(raw?: string): boolean {
  const normalized = normalizeMessageChannel(raw);
  return normalized === "feishu" || normalized === "lark";
}

function shouldTrackRun(params: CreateRunProgressSupervisorParams): boolean {
  if (!params.config || !params.messageTo?.trim()) {
    return false;
  }
  if (!isFeishuChannel(params.messageChannel ?? params.messageProvider)) {
    return false;
  }
  if (params.trigger && params.trigger !== "user" && params.trigger !== "manual") {
    return false;
  }
  return true;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function extractMessageId(result: MessageActionRunResult): string | undefined {
  const payload = result.payload;
  if (payload && typeof payload === "object") {
    const messageId = readString((payload as Record<string, unknown>).messageId);
    if (messageId) {
      return messageId;
    }
  }
  if ("sendResult" in result && result.sendResult && typeof result.sendResult === "object") {
    return readString((result.sendResult as Record<string, unknown>).messageId);
  }
  return undefined;
}

export function createRunProgressSupervisor(
  params: CreateRunProgressSupervisorParams,
): RunProgressSupervisor {
  if (!shouldTrackRun(params)) {
    return noopSupervisor;
  }
  const cfg = params.config;
  const to = params.messageTo?.trim();
  if (!cfg || !to) {
    return noopSupervisor;
  }

  const now = params.deps?.now ?? (() => Date.now());
  const setTimer = params.deps?.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    params.deps?.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const sendAction = params.deps?.sendAction ?? runMessageAction;
  const startedAt = now();
  const accountId = params.agentAccountId?.trim() || undefined;
  const steps: ProgressStep[] = [];
  const stepIndexByToolCallId = new Map<string, number>();
  let timer: unknown = undefined;
  let assistantStarted = false;
  let finished = false;
  let cardMessageId: string | undefined;
  let sendPromise: Promise<void> | undefined;
  let updateChain: Promise<void> = Promise.resolve();
  let activeToolName: string | undefined;
  let toolCallCount = 0;

  const clearInitialTimer = () => {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  };

  const buildCard = (finish?: RunProgressFinishParams) => {
    const elapsed = formatElapsed((finish?.durationMs ?? now() - startedAt) || 0);
    const status = finish
      ? finish.aborted
        ? "canceled"
        : finish.success
          ? "succeeded"
          : "failed"
      : "running";
    const summary = finish
      ? finish.aborted
        ? "任务已取消。"
        : finish.success
          ? "任务已完成，最终回复正在或已经发送。"
          : truncateText(finish.error || "任务执行失败。", 240)
      : activeToolName
        ? `正在执行 ${humanizeToolName(activeToolName)}。`
        : "任务仍在处理中。";

    return {
      title: "OpenClaw 正在处理",
      taskId: params.runId,
      status,
      summary,
      elapsed,
      metrics: [
        { label: "会话", value: params.sessionKey ?? params.sessionId },
        { label: "工具调用", value: String(toolCallCount) },
      ],
      steps: steps.slice(-MAX_STEPS),
    };
  };

  const sendInitialCard = async () => {
    if (finished || assistantStarted || cardMessageId || sendPromise) {
      return;
    }
    sendPromise = (async () => {
      try {
        const result = await sendAction({
          cfg,
          action: "send",
          params: {
            channel: "feishu",
            to,
            ...(accountId ? { accountId } : {}),
            progressCard: buildCard(),
          },
          defaultAccountId: accountId,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          agentId: params.agentId,
        });
        cardMessageId = extractMessageId(result);
        if (!cardMessageId) {
          log.warn(`progress card send returned no messageId for runId=${params.runId}`);
        }
      } catch (err) {
        log.warn(`progress card send failed for runId=${params.runId}: ${String(err)}`);
      } finally {
        sendPromise = undefined;
      }
    })();
    await sendPromise;
  };

  const queueCardUpdate = (finish?: RunProgressFinishParams) => {
    if (!cardMessageId || !params.config) {
      return;
    }
    const messageId = cardMessageId;
    const progressCard = buildCard(finish);
    updateChain = updateChain
      .then(async () => {
        try {
          await sendAction({
            cfg,
            action: "edit",
            params: {
              channel: "feishu",
              messageId,
              ...(accountId ? { accountId } : {}),
              progressCard,
            },
            defaultAccountId: accountId,
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            agentId: params.agentId,
          });
        } catch (err) {
          log.warn(`progress card update failed for runId=${params.runId}: ${String(err)}`);
        }
      })
      .catch((err) => {
        log.warn(`progress card update chain failed for runId=${params.runId}: ${String(err)}`);
      });
  };

  timer = setTimer(
    () => {
      void sendInitialCard();
    },
    Math.max(1, params.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS),
  );

  return {
    onAgentEvent(event) {
      if (finished || event.stream !== "tool") {
        return;
      }
      const phase = readString(event.data.phase);
      const toolName = readString(event.data.name);
      const toolCallId = readString(event.data.toolCallId);
      if (!phase || !toolName) {
        return;
      }
      if (phase === "start") {
        activeToolName = toolName;
        toolCallCount += 1;
        const step: ProgressStep = {
          title: `执行 ${humanizeToolName(toolName)}`,
          status: "running",
        };
        steps.push(step);
        if (toolCallId) {
          stepIndexByToolCallId.set(toolCallId, steps.length - 1);
        }
        queueCardUpdate();
        return;
      }
      if (phase === "result") {
        const isError = event.data.isError === true;
        const index = toolCallId ? stepIndexByToolCallId.get(toolCallId) : undefined;
        if (index !== undefined && steps[index]) {
          steps[index] = {
            ...steps[index],
            status: isError ? "failed" : "succeeded",
          };
          stepIndexByToolCallId.delete(toolCallId!);
        }
        if (activeToolName === toolName) {
          activeToolName = undefined;
        }
        queueCardUpdate();
      }
    },
    onAssistantMessageStart() {
      assistantStarted = true;
      if (!cardMessageId) {
        clearInitialTimer();
        return;
      }
      activeToolName = undefined;
      queueCardUpdate();
    },
    async finish(finishParams) {
      if (finished) {
        return;
      }
      finished = true;
      clearInitialTimer();
      if (sendPromise) {
        await sendPromise;
      }
      if (!cardMessageId) {
        return;
      }
      queueCardUpdate(finishParams);
      await updateChain;
    },
  };
}
