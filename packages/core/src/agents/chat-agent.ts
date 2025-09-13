import type { ChatOptions, CommonContentPart, Message, Tool } from '@xsai/shared-chat'
import type { StreamTextResult } from '@xsai/stream-text'

import { streamText } from '@xsai/stream-text'

import type { BaseAgentOptions, BaseAgentPlugin } from './base-agent'

import { BaseAgent } from './base-agent'

export interface ChatAgentOptions extends BaseAgentOptions {
  instruction: string
  llm: Omit<ChatOptions, 'messages' | 'tools'>
  tools?: Tool[]
  transformMessages?: (message: Message[]) => Message[]
}

export interface ChatAgentPlugin extends BaseAgentPlugin {
  tools?: Tool[]
  transformMessages?: (message: Message[]) => Message[]
}

export interface ChatAgentRunOptions {
  messages?: Message[]
}

export class ChatAgent extends BaseAgent implements BaseAgent<
  CommonContentPart[] | string,
  StreamTextResult,
  ChatAgentRunOptions
> {
  public instruction: string
  public llm: Omit<ChatOptions, 'messages' | 'tools'>
  public tools?: Tool[]
  public transformMessages?: (message: Message[]) => Message[]

  constructor(options: ChatAgentOptions) {
    super(options)

    this.instruction = options.instruction
    this.llm = options.llm

    if (options.tools)
      this.tools = options.tools
  }

  public run(content: CommonContentPart[] | string, options?: ChatAgentRunOptions) {
    let messages = options?.messages ?? [{
      content: this.instruction,
      role: 'system',
    }]

    if (this.transformMessages)
      messages = this.transformMessages(messages)

    for (const plugin of this.plugins) {
      if ('transformMessages' in plugin && (plugin as ChatAgentPlugin).transformMessages)
        messages = (plugin as ChatAgentPlugin).transformMessages!(messages)
    }

    return streamText({
      ...this.llm,
      baseURL: this.llm.baseURL as string,
      messages: [
        ...messages,
        {
          content,
          role: 'user',
        },
      ],
      model: this.llm.model as string,
    })
  }
}
