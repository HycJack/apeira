# Input

Every turn consumes one or more `AgentInput` objects. This page covers the input helpers, input types, and how inputs become part of the append-only log.

## Input helpers

Apeira exports small helpers for building `AgentInput` objects:

```ts twoslash
import { assistant, developer, system, user } from '@apeira/core'

const inputs = [
  system('You are a concise assistant.'),
  user('Hello.'),
  assistant('Hi there.'),
  developer('The user prefers short answers.'),
]
```

Each helper returns an object with `{ content, role, type: 'message' }` shaped for the runner.

| Helper | Role | Use for |
|--------|------|---------|
| `user()` | `user` | Messages from the user. |
| `assistant()` | `assistant` | Model outputs; wrapped in `output_text` parts. |
| `system()` | `system` | High-level system instructions. |
| `developer()` | `developer` | Developer-provided messages (OpenAI developer role). |

All helpers accept either a plain string or a template string array:

```ts twoslash
import { user } from '@apeira/core'

const name = 'Apeira'
const input = user(`Hello, ${name}!`)
```

## Submitting input

`run()` and `send()` both accept a single `AgentInput`:

```ts twoslash
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

const stream = run(agent, user('Say hello.'))
```

If a turn is already active, `send()` queues the input into that turn instead of creating a new top-level turn.

## Input types

`AgentInput` is a union of message and tool-related types. The most common are:

```ts
import type { AgentInput } from '@apeira/core'

const input: AgentInput = {
  content: 'Hello.',
  role: 'user',
  type: 'message',
}
```

Core input types include:

- `AgentUserMessageInput` – `user('...')`
- `AgentAssistantMessageInput` – `assistant('...')`, also used for model outputs with optional `tool_calls` and `reasoning`
- `AgentSystemMessageInput` – `system('...')`
- `AgentDeveloperMessageInput` – `developer('...')`
- `AgentFunctionCallInput` / `AgentFunctionCallOutputInput` – tool call and result entries

## Building input arrays

Use the `entry()` and `toAgentInput()` helpers when working with storage entries:

```ts twoslash
import { entry, toAgentInput, user } from '@apeira/core'

const inputEntry = entry('input', user('Hello.'))
const inputs = toAgentInput([inputEntry])
```

`toAgentInput()` filters an array of `AgentEntry` objects down to only `input` entries and returns their data payloads. This is what Apeira does internally before passing history to the runner.

## `initialInput`

Seed the agent's history with `initialInput`. These entries are written to storage on first `init()` only if the storage does not already contain input entries.

```ts twoslash
import { createAgent, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialInput: [user('The user\'s name is Alice.')],
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

Existing input history always takes precedence, so `initialInput` is safe to set even when reloading from persistent storage.
