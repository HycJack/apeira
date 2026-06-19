# Entry

Apeira stores everything as append-only entries. This page covers the entry model: the core entry types, how to build entries, custom entry types, and the storage contract.

## `AgentEntry`

Every item stored by Apeira is an `AgentEntry`:

```ts
interface AgentEntry<T extends keyof AgentCustomEntry = keyof AgentCustomEntry> {
  data: AgentCustomEntry[T]
  id: string
  parentId?: string
  timestamp: number
  type: T
}
```

Every entry has:

- `id` – a unique identifier (`crypto.randomUUID()` by default).
- `type` – the entry kind, e.g. `'input'`, `'state'`, `'event'`.
- `data` – the payload, typed by `type`.
- `timestamp` – creation time in milliseconds. (`Date.now()` by default)
- `parentId` – optional pointer used by sessions and semantic entries to build trees.

## Core entry types

### `input`

`input` entries store messages, tool calls, and model outputs that are passed to the runner.

```ts twoslash
import { entry, toAgentInput, user } from '@apeira/core'

const e = entry('input', user('Hello.'))
const inputs = toAgentInput([e])
```

See [Input](/guide/input) for the input types and helpers.

### `state`

`state` entries store snapshots of `agent.state`. The latest state entry is restored on `init()`.

```ts twoslash
import { entry } from '@apeira/core'

const e = entry('state', { userName: 'Alice' })
```

See [State](/guide/state) for managing state.

### `event`

`event` entries store events emitted with `agent.emit(..., { save: true })`. They are typically used for audit trails or session tracking.

```ts twoslash
import { entry } from '@apeira/core'

const e = entry('event', {
  turnId: crypto.randomUUID(),
  type: 'agent.reset',
})
```

## Helpers

- `entry(type, data)` – creates an `AgentEntry` with a generated `id` and `timestamp`.
- `toAgentInput(entries)` – filters an array of entries to only `input` entries and returns their data.

```ts twoslash
import { entry, toAgentInput, user } from '@apeira/core'

const inputEntry = entry('input', user('Hello.'))
const inputs = toAgentInput([inputEntry])
```

## How Apeira uses entries

1. **Initialization** – if storage has no `input` entries, Apeira writes `initialInput`.
2. **State restore** – the latest `state` entry is loaded into `agent.state`.
3. **Turn start** – Apeira reads entries, transforms them through plugins, and converts them to model input with `toAgentInput()`.
4. **Turn success** – new inputs and model outputs are appended as `input` entries.
5. **Reset** – storage is cleared and `initialInput` / `initialState` are restored.

## Custom entry types

Plugins can add custom entry types by extending `AgentCustomEntry`:

```ts
import type { AgentCustomEntry } from '@apeira/core'

declare module '@apeira/core' {
  interface AgentCustomEntry {
    'my-plugin/config': { value: string }
  }
}
```

After declaration, `entry('my-plugin/config', { value: 'x' })` is fully typed. Custom entries are preserved by `@apeira/session` as ordinary semantic nodes.

## Reading entries

You can read the current storage entries at any time:

```ts twoslash
import { createAgent, mem } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: mem(),
})

const entries = await agent.storage.read()
```

Each entry has `id`, `timestamp`, `type`, and `data`. See [Storage](/guide/storage) for choosing a storage backend.

## Storage contract

`AgentStorage` only sees entries. It does not know about turns, plugins, or runners. This separation is what makes custom storage backends simple: they only need to implement `append`, `clear`, and `read`.
