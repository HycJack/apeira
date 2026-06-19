# Session

`@apeira/session` adds tree-shaped, durable conversation history on top of Apeira's append-only entry model. It is useful when you need branches, checkpoints, or long-running memory that survives restarts.

## Create a session

A session wraps a storage backend and exposes a branch-aware `AgentStorage` view.

```ts twoslash
import { createAgent, mem } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { createSession } from '@apeira/session'

const session = createSession({
  defaultRef: 'main',
  sessionStorage: mem(),
})

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [session.plugin],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: session.storage,
})
```

- `sessionStorage` holds the complete append-only log, including branch control entries.
- `session.storage` is the active branch view that core reads and writes.
- `session.plugin` keeps `agent.state` in sync when the active branch changes.

## Branches

Sessions use **refs** (named branches) and **checkouts** (the current head). You can fork, checkout, and rebase branches the same way you work with Git.

```ts
await session.fork('experiment')
await session.checkout('main')
await session.rebase('experiment', 'main')
```

Strings are resolved as refs first, then as entry ids. `checkout()` without a target creates a detached empty context.

## Read branch state

Use `buildInput()` and `buildState()` to reconstruct the input history or state at any ref or entry id:

```ts
const input = await session.buildInput('experiment')
const state = await session.buildState('experiment')
```

`session.path(target)` returns the full entry path for a branch, which is useful for custom visualization or debugging.

## Branch change events

The session plugin emits branch changes on the agent channel as `session.checkout`, `session.fork`, and `session.rebase` events with `save: false`, so subscribers can react without persisting extra entries.

```ts
agent.subscribe('session.checkout', ({ ref, state, targetId }) => {
  // ref is the checked-out branch name, if any
  // state is the reconstructed agent state at that head
  // targetId is the head entry id
})
```

## Clone a session

`clone()` copies selected refs and their history into a new storage backend. This is useful for exporting, backing up, or migrating sessions.

```ts
const cloned = await session.clone({
  refs: 'all',
  sessionStorage: mem(),
})
```

## Custom semantic entries

Every entry except lifecycle and session control entries is treated as a semantic branch node. Plugin-defined entries receive `parentId`, advance the active branch, and are preserved by path, rebase, and clone operations without session-specific configuration.

For example, `@apeira/plugin-compact` works directly with session storage:

```ts
const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [compact({ compactAgent: { runner: summaryRunner } })],
  storage: session.storage,
})
```

Session stores the compact entry as an ordinary semantic node. The plugin owns how that entry is projected into model context.

## When to use sessions

Use `@apeira/session` when you need:

- Named branches or checkpoints.
- Durable history that survives process restarts (with a persistent `sessionStorage`).
- Rebase / merge-like workflows for conversation history.
- Multiple parallel contexts sharing the same base history.

For simple, linear agents, the built-in `mem()` or `@apeira/storage` backends are enough.
