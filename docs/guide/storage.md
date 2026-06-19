---
outline: deep
---

# Storage

Apeira persists everything through the `AgentStorage` interface. This page covers the storage contract, the built-in memory backends, and the persistent backends provided by `@apeira/storage`.

## The `AgentStorage` interface

Any storage backend only needs three operations:

```ts
import type { MaybePromise } from '@apeira/core'

interface AgentStorage<T> {
  append: (...items: T[]) => MaybePromise<void>
  clear: () => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
}
```

`T` defaults to `AgentEntry`. You can use the same interface for other JSON-serializable types. See [Entry](/guide/entry) for the data model that flows through storage.

## Storage lifecycle

All `AgentStorage` implementations provide the same three operations:

- `append(...items)` – add entries to the log.
- `clear()` – remove all entries.
- `read()` – return the current log.

Agent initialization and reset baselines belong to core. During initialization, core writes `initialInput` only when storage contains no input entries. `agent.reset()` clears storage and restores `initialInput` and `initialState`.

## Built-in

### mem

`mem()` keeps entries in an in-memory array. It is the default when no `storage` is passed to `createAgent()`.

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

### none

`none()` discards every operation and is useful for tests or ephemeral agents.

```ts twoslash
import { createAgent, none } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: none(),
})
```

## Extra

Use `@apeira/storage` for persistent storages.

### json

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { json } from '@apeira/storage/json'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: json({ path: './data/agent.json' }),
})
```

JSON storage rewrites the entire file on every append. Use it when human-readable files are useful and the history is small.

### jsonl

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { jsonl } from '@apeira/storage/jsonl'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: jsonl({ path: './data/agent.jsonl' }),
})
```

JSONL appends one entry per line without rewriting existing content. It is the better format for long-running, append-heavy agents.

### kv

```ts
import type { StorageLike } from '@apeira/storage/kv'

import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { kv } from '@apeira/storage/kv'

declare const backend: StorageLike

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner,
  storage: kv({
    backend,
    prefix: 'assistant',
    segmentSize: 100,
  }),
})
```

The backend must implement `getItem`, `setItem`, and `removeItem`. Key-value storage splits the log into segments so the complete history is never stored under a single key.

for example:

```ts twoslash
import { kv } from '@apeira/storage/kv'

const storage = kv({ backend: localStorage })
```

## Custom

You can bring your own backend by implementing `AgentStorage<AgentEntry>`. Because storage only sees entries, custom backends are small: they do not need to know about turns, plugins, or runners.
