# @apeira/storage

Persistent `AgentStorage` implementations for Apeira.

## Install

```sh
pnpm add @apeira/storage
```

## JSON

Stores the complete entry array in a JSON file. Each append rewrites the file.

```ts
import { createAgent } from '@apeira/core'
import { json } from '@apeira/storage/json'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner,
  storage: json({ path: './data/agent.json' }),
})
```

Use JSON storage when human-readable files are useful and the history is
relatively small.

## JSONL

Stores one entry per line and appends new entries without rewriting existing
content.

```ts
import { createAgent } from '@apeira/core'
import { jsonl } from '@apeira/storage/jsonl'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner,
  storage: jsonl({ path: './data/agent.jsonl' }),
})
```

JSONL is the better file format for long-running, append-heavy agents.

## Key-value storage

Adapts a string key-value backend such as Web Storage or an asynchronous
storage API. Entries are split into segments to avoid storing the complete log
under one key.

```ts
import type { StorageLike } from '@apeira/storage/kv'

import { createAgent } from '@apeira/core'
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

The backend must implement:

```ts
import type { MaybePromise } from '@apeira/core'

interface StorageLike {
  getItem: (key: string) => MaybePromise<null | string | undefined>
  removeItem: (key: string) => MaybePromise<void>
  setItem: (key: string, value: string) => MaybePromise<void>
}
```

`prefix` defaults to `apeira` and `segmentSize` defaults to `100`.

## Storage lifecycle

All implementations provide the standard `AgentStorage` operations:

```ts
import type { MaybePromise } from '@apeira/core'

interface AgentStorage<T> {
  append: (...items: T[]) => MaybePromise<void>
  clear: () => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
}
```

Storage only manages persisted entries. Agent initialization and reset
baselines belong to core:

```ts
const agent = createAgent({
  initialInput: [user('Existing context')],
  initialState: { userId: 'user-123' },
  instructions: 'You are a helpful assistant.',
  runner,
  storage: jsonl({ path: './data/agent.jsonl' }),
})
```

During initialization, core writes `initialInput` only when storage contains no
input entries. `agent.reset()` clears storage and restores `initialInput` and
`initialState`.

## Generic storage

The storage functions default to `AgentEntry`, but can store another
JSON-serializable type:

```ts
const store = jsonl<string>({ path: './data/items.jsonl' })

await store.append('first', 'second')
const items = await store.read()
```

JSON and JSONL storage require Node.js. Key-value storage works in any runtime
that provides a compatible backend.
