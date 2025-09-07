import type { CommonContentPart } from '@xsai/shared-chat'

import { generateText } from '@xsai/generate-text'
import { streamText } from '@xsai/stream-text'

import type { Plugin } from '../types/plugin'

export interface AgentOptions {
  apiKey?: string
  baseURL: URL
  instructions?: string
  model: string
  plugins?: Plugin[]
}

export interface AgentRunOptions {

}

export class Agent {
  apiKey?: string
  baseURL: URL
  instructions: string = 'You\'re a helpful assistant.'
  model: string
  plugins: Plugin[] = []

  constructor(options: AgentOptions) {
    this.baseURL = options.baseURL
    this.model = options.model

    if (options.apiKey != null)
      this.apiKey = options.apiKey

    if (options.instructions != null)
      this.instructions = options.instructions

    if (options.plugins)
      this.plugins = options.plugins
  }

  public async run(content: CommonContentPart[] | string, _options: AgentRunOptions) {
    return generateText({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      messages: [
        { content: this.instructions, role: 'system' },
        { content, role: 'user' },
      ],
      model: this.model,
    })
  }

  public async runStream(content: CommonContentPart[] | string, _options: AgentRunOptions) {
    return streamText({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      messages: [
        { content: this.instructions, role: 'system' },
        { content, role: 'user' },
      ],
      model: this.model,
    })
  }
}
