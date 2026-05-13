# Packages

## apeira

`apeira` is the top-level package. It currently re-exports everything from
`@apeira/core`.

```ts
import { createAgent } from 'apeira'
```

Use this package when you want the default public entry point.

## @apeira/core

`@apeira/core` contains the stream-first agent runtime.

```ts
import { createAgent } from '@apeira/core'
```

It provides:

- `createAgent()`
- lifecycle events
- per-turn `ReadableStream` support through `run()`
- fire-and-forget submission through `send()`
- global subscriptions
- abort and clear behavior
- in-memory history
