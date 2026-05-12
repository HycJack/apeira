# Apeira

## Usage

```ts
import { createAgent } from '@apeira/core'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.4',
  },
})

const unsubscribe = agent.subscribe((event) => {
  console.log(event.turnId, event.type)
})

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

`send()` returns the turn id immediately. Turn progress is reported through
subscribed events.

### Agent Lifecycle

Each agent keeps an in-memory `history` of completed turns. When a turn starts,
the new input is appended to the current history and passed to
`@xsai-ext/responses`. When the turn completes successfully, the returned input
state becomes the next history.

Submitted turns run one at a time. If `send()` is called while another turn is
running, the new turn waits until the running turn finishes.

The agent emits Apeira lifecycle events:

- `turn.start`
- `turn.done`
- `turn.failed`
- `turn.aborted`

It also forwards streaming events from `@xsai-ext/responses`, with `turnId`
attached to every event.

### Abort And Clear

Abort the currently running turn:

```ts
agent.abort('user cancelled')
```

Clear the session:

```ts
agent.clear()
```

`clear()` aborts the running turn, clears queued turns, and resets in-memory
history.

You can also pass an external `AbortSignal` to a single turn:

```ts
const controller = new AbortController()

agent.send(
  {
    content: 'Write a long answer.',
    role: 'user',
    type: 'message',
  },
  controller.signal,
)

controller.abort('cancelled')
```

## License

[MIT](LICENSE.md)
