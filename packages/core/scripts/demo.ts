import type { Message } from '@xsai/shared-chat'

import fs from 'node:fs/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { ChatAgent } from '../src/agents/chat-agent'
import { autoSaveMessages } from '../src/plugins/auto-save-messages'
import { trimMessages } from '../src/plugins/trim-messages'

const savedMessages = new URL('demo.messages.json', import.meta.url)

const agent = new ChatAgent({
  instruction: 'You\'re a helpful assistant.',
  llm: {
    baseURL: 'http://localhost:11434/v1/',
    model: 'gpt-oss',
  },
  name: 'chat-agent',
  plugins: [
    autoSaveMessages({
      load: async () => {
        try {
          const json = await fs.readFile(savedMessages, { encoding: 'utf8' })
          // eslint-disable-next-line @masknet/type-prefer-return-type-annotation
          return JSON.parse(json) as Message[]
        }
        catch {
          console.error('auto-save-messages: load failed')
          return []
        }
      },
      save: async (messages) => {
        try {
          await fs.writeFile(savedMessages, JSON.stringify(messages))
        }
        catch {
          console.error('auto-save-messages: save failed')
        }
      },
    }),
    trimMessages(),
  ],
})

await agent.start()

const rl = createInterface({ input, output })

try {
  while (true) {
    const content = await rl.question('> Write a message... ')

    const { textStream } = agent.run(content)

    for await (const textPart of textStream)
      output.write(textPart)

    console.log('\n')
  }
}
catch (error) {
  console.error(error)
}
finally {
  rl.close()
  await agent.close()
}
