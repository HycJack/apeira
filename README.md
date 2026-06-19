# Apeira

stream-first Agent Runtime.

## Quick Start

```bash
pnpm add @apeira/core
# or the umbrella package
pnpm add apeira
```

Create an agent and run a turn:

```ts
import { createAgent, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

for await (const event of run(agent, user('Say hello.')))
  console.log(event.turnId, event.type)
```

`run()` returns a `ReadableStream` of lifecycle and model events for the turn.

For fire-and-forget usage, subscribe to events with `agent.subscribe()` and submit turns with `agent.send()`:

```ts
agent.subscribe('apeira', event => console.log(event.turnId, event.type))
agent.send(user('Say hello.'))
```

## Documentation

Detailed guides, examples, and API references live in https://apeira.moeru.ai.

## License

[MIT](LICENSE.md)
