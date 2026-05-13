// TODO: ToolWithContext
export type AgentContext<T> = T & {
  contextLength?: number
  metadata?: Record<string, unknown>
}
