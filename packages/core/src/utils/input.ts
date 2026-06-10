import type { AgentAssistantMessageInput, AgentDeveloperMessageInput, AgentSystemMessageInput, AgentUserMessageInput } from '../types/input'

const message = <T>(role: string) => (content: string | TemplateStringsArray, ...substitutions: unknown[]) => ({
  content: (typeof content === 'string') ? content : String.raw(content, ...substitutions),
  role,
  type: 'message',
}) as T

export const assistant = message<AgentAssistantMessageInput>('assistant')

export const developer = message<AgentDeveloperMessageInput>('developer')

export const system = message<AgentSystemMessageInput>('system')

export const user = message<AgentUserMessageInput>('user')
