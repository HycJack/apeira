# Agent Lifecycle

An Apeira agent owns one or more sessions. Each session keeps an in-memory history
and runs submitted turns one at a time.

## History

The default session starts with the optional `input` passed to `createAgent()`.
Explicit sessions can also receive their own initial `input`.

When a turn starts, Apeira appends the new input item to the current history and
passes that full input state to `@xsai-ext/responses`.

When the turn completes successfully, Apeira commits the returned input state as
the next history.

```ts
const agent = createAgent({
  input: [
    {
      content: 'You have already introduced yourself.',
      role: 'user',
      type: 'message',
    },
  ],
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})
```

## Queueing

Top-level turns submitted to the same session with `run()` are serialized. If
`run()` is called while another turn is running on that session, the new turn
waits until the running turn finishes. Different sessions can run concurrently.

```ts
const first = agent.run({
  content: 'First turn.',
  role: 'user',
  type: 'message',
})

const second = agent.run({
  content: 'Second turn.',
  role: 'user',
  type: 'message',
})
```

`second` will not start until `first` is done, failed, or aborted.

`send()` is a fire-and-forget input entrypoint. If no turn is active or
scheduled, it creates a new top-level turn. If a turn is already active or
scheduled, the input is queued for that turn and drained after the current model
response completes.

If the active turn has already been aborted, new input is queued for the next
scheduled turn. If no turn is scheduled, it creates a new turn.

## Interrupt

`interrupt()` aborts the active turn and records a model-visible turn-aborted
boundary.

```ts
agent.interrupt('user interrupted')
```

The boundary is visible to the model on the next turn. The queue continues
normally — any queued turns run after the interrupted turn is aborted.

## Clear

`clear()` aborts the running turn, clears queued turns, and resets in-memory
history to the original `input`.

```ts
agent.clear()
```

The running turn emits `turn.aborted` with the reason `cleared`.

Queued turns are removed before they start.

## Context

Agent context starts as the complete default context. Agent, session, and run
context updates are partial overlays. Instructions receive the merged context.

```ts
const agent = createAgent({
  context: {
    locale: 'en-US',
    userId: 'user_123',
  },
  instructions: context => `You are helping ${context.userId}.`,
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})

const context = agent.getContext()
```

Use `setContext()` to update agent or session context:

```ts
agent.setContext({
  locale: 'en-US',
  userId: 'user_123',
})

const session = agent.session({
  context: {
    userId: 'user_456',
  },
})

session.setContext({
  locale: 'zh-CN',
})
```

Run context only applies to the submitted input:

```ts
session.run(input, {
  context: {
    requestId: 'req_123',
  },
})
```
