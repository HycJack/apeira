# Core API

The core API is exported from both `apeira` and `@apeira/core`.

```ts
import { createAgent } from 'apeira'
// or
import { createAgent } from '@apeira/core'
```

## createAgent()

```ts
const agent = createAgent({
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})
```

### Options

```ts
interface CreateAgentOptions<T> {
  context?: AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}
```

`options` are xsAI response options. Apeira owns the input state, instructions,
and abort signal for each turn.

## Agent

```ts
interface Agent<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  interrupt: (reason?: unknown) => void
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
  subscribe: (eventListener: AgentEventListener) => () => boolean
  session: (options?: SessionOptions<T>) => AgentSession<T>
}
```

### run()

Submits a turn and returns a stream of events for that turn.

```ts
const stream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

Pass run options with a transient context overlay or `AbortSignal`:

```ts
agent.run(input, {
  context: { requestId: 'req_123' },
  signal,
})
```

### send()

Submits input and returns a turn id immediately.

```ts
const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

If no turn is active or scheduled, `send()` creates a new top-level turn. If a
turn is active or scheduled, the input is queued for that turn and the returned
id is the existing turn id.

If the active turn is already aborted, `send()` targets the next scheduled turn
instead. If no turn is scheduled, it creates a new turn.

Use `subscribe()` to observe progress.

### interrupt()

Interrupts the active turn and records a model-visible turn-aborted boundary.

```ts
agent.interrupt('user interrupted')
```

The boundary is visible to the model on the next turn. The queue continues
normally — any queued turns will run after the interrupted turn is aborted.

### sessions

The root agent methods use a default session. Create or address explicit sessions
when one agent definition should serve multiple conversations:

```ts
const session = agent.session({
  context: { userId: 'user_123' },
})

session.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

Each session has its own queue, interrupt state, in-memory history, and context
overlay. Different sessions can run concurrently. Calling `session()` with an
existing `id` returns that session and merges the provided context overlay. The
`input` option only applies when creating a new session.

### setContext()

Agent context starts as the complete default context. Agent, session, and run
context updates are partial overlays.

```ts
agent.setContext({
  locale: 'en-US',
  product: 'docs',
})

session.setContext({
  locale: 'zh-CN',
})
```

Instructions receive the merged context:

```ts
const effectiveContext = merge(agentContext, sessionContext, runContext)
```

`agent.setContext()` persists as the agent default. `session.setContext()`
persists for later turns on that session. Run context does not persist.

### subscribe()

Subscribes to all events from the agent.

```ts
const unsubscribe = agent.subscribe(event =>
  console.log(event.turnId, event.type)
)
```

The returned function removes the listener and returns whether it was present.

### abort()

Aborts the currently running turn without recording a boundary.

```ts
agent.abort('user cancelled')
```

Use `interrupt()` to abort and record a model-visible turn-aborted boundary.
Use `abort()` + `send()` to abort and submit different input.

### clear()

Aborts the running turn, clears queued turns, and resets in-memory history.

```ts
agent.clear()
```

### getContext()

Returns the agent context object.

```ts
const context = agent.getContext()
```

## Types

```ts
type AgentEvent = WithTurnId<ApeiraEvent | XSAIEvent>

type AgentEventListener = (event: AgentEvent) => unknown

type ItemParam = Exclude<ResponsesOptions['input'], string>[number]

type WithTurnId<T> = T & {
  sessionId: string
  turnId: string
}
```
