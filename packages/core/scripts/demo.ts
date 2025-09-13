import type { Message } from '@xsai/shared-chat'

import { stdin as input, stdout as output } from 'node:process'
import * as readline from 'node:readline/promises'
import { Writable } from 'node:stream'

import { ChatAgent } from '../src/agents/chat-agent'

const agent = new ChatAgent({
  instruction: 'You\'re a helpful assistant.',
  llm: {
    baseURL: 'http://localhost:11434/v1/',
    model: 'gemma3n:e2b',
  },
  name: 'chat-agent',
})

const rl = readline.createInterface({ input, output })

let messages: Message[] | undefined

try {
  while (true) {
    const content = await rl.question('> Write a message...')

    console.log('\n')

    const { messages: pm, textStream } = agent.run(content, { messages })

    await textStream.pipeTo(Writable.toWeb(output) as WritableStream<string>)

    messages = await pm

    console.log('\n')
  }
}
catch (error) {
  console.error(error)
}
finally {
  rl.close()
}
