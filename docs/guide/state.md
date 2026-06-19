# State

Agent `state` is a plain object that plugins and instructions can read and write. It is useful for anything that needs to persist across turns: user preferences, conversation context, or plugin-managed counters.

## Initial state

Pass `initialState` to `createAgent()`. It becomes the reset baseline and is restored by `agent.reset()`.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: state => `You are helping ${state.userName ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

When `instructions` is a function, it receives the current state so the system prompt can change between turns.

## Read and write state

Use the `agent.state` manager:

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

// read
console.log(agent.state.get().userName)

// patch
agent.state.update({ userName: 'Bob' })

// replace with a function
agent.state.set(prev => ({ ...prev, userName: 'Carol' }))

// replace directly
agent.state.set({ userName: 'Dave' })
```

## Persistence

State changes are persisted to storage as `state` entries. On initialization, the latest `state` entry is restored, falling back to `initialState`.

```ts twoslash
import { createAgent, mem } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: mem(),
})

agent.state.update({ userName: 'Bob' })

const entries = await agent.storage.read()
const stateEntries = entries.filter(e => e.type === 'state')
```

## State in plugins

Plugins receive the current state in `extendInstructions` and `extendTools`:

```ts twoslash
import type { AgentPlugin } from '@apeira/core'

declare module '@apeira/core' {
  interface AgentCustomState {
    timezone?: string
  }
}

const timezonePlugin: AgentPlugin = {
  extendInstructions: ({ state }) =>
    `The user's timezone is ${state.timezone ?? 'UTC'}.`,
  name: 'timezone',
}
```

## Extending state

Plugins can extend `AgentState` through declaration merging:

```ts
declare module '@apeira/core' {
  interface AgentCustomState {
    timezone?: string
  }
}
```

After declaration, `agent.state.get().timezone` is typed.

By default, custom fields should be **optional**. This lets users create an agent without providing the field, and lets plugins use `??` to supply a default value. Only make a field required when the plugin genuinely cannot function without an explicit value from the user.

## Built-in fields

Apeira reserves a few fields on `AgentState` for common use cases:

| Field | Purpose |
|-------|---------|
| `agentDescription` | Description of the agent persona. |
| `agentName` | Name of the agent. |
| `contextLength` | Context length hint, e.g. for compaction plugins. |
| `userDescription` | Description of the user. |
| `userName` | Name of the user. |
