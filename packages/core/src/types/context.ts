// TODO: ToolWithContext
export type AgentContext<T> = T & {
  contextLength?: number
  metadata?: Record<string, unknown>
}

export type Instructions<T> = ((context: AgentContext<T>) => Promise<string> | string) | string
