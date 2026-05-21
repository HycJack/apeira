# @apeira/plugin-unstorage

Wraps the [unstorage](https://unstorage.unjs.io/) universal storage layer as an Apeira storage plugin for session persistence.

## Install

```sh
pnpm add @apeira/plugin-unstorage
```

## Usage

```ts
import fsDriver from 'unstorage/drivers/fs'

import { createAgent } from '@apeira/core'
import { unstorage } from '@apeira/plugin-unstorage'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    unstorage({
      driver: fsDriver({ base: './data' }),
    }),
  ],
})
```

## API

### `unstorage(options)`

Creates an Apeira plugin that provides session persistence through any unstorage backend.

| Backend | Driver | Usage |
|---------|--------|-------|
| Filesystem | `fsDriver` | Local development |
| Redis | `redisDriver` | Production caching |
| S3 | `s3Driver` | Cloud storage |
| Memory | `memoryDriver` | Testing |

See the [unstorage documentation](https://unstorage.unjs.io/) for the full list of drivers.

### How it works

When a storage plugin is present, Apeira serializes session state (context + history + version) to JSON after each turn. Optimistic concurrency via a version counter prevents conflicting writes across sessions.
