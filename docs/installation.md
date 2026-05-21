# Installation

## Requirements

- Node.js 18 or newer
- `pnpm`, `npm`, or `yarn`

## Install the umbrella package

```sh
pnpm add apeira
```

```sh
npm install apeira
```

```sh
yarn add apeira
```

## Install the core package directly

If you want the runtime without any extras:

```sh
pnpm add @apeira/core
```

`@apeira/core` contains only the agent factory, types, and event system. Plugins like `@apeira/plugin-skills` are installed separately.

## Verify the install

Run a quick check that the package loads:

```ts
import { createAgent } from 'apeira'

console.log(typeof createAgent) // 'function'
```

If you see `'function'`, Apeira is ready to use.
