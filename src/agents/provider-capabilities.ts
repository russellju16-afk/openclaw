export type ProviderCapabilities = {
  openaiReasoningBlocks?: boolean;
  anthropicThinkingBlocks?: boolean;
  sanitizeToolSchemas?: boolean;
  sanitizeReplayHistory?: boolean;
  validateReplayTurns?: boolean;
  cloudCodeAssistToolCallIds?: boolean;
  interSessionUserProvenance?: boolean;
};
