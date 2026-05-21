# @apeira/plugin-skills

A filesystem-agnostic skills system for Apeira. Skills are named instruction sets that the model can load on demand via a `skill` tool.

## Install

```sh
pnpm add @apeira/plugin-skills
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { createSkillsRegistry, skills } from '@apeira/plugin-skills'

const registry = createSkillsRegistry({
  skills: [
    {
      content: '# Math\nUse proper notation and show steps.',
      description: 'Expert math problem solving.',
      filePath: '.agents/skills/math/SKILL.md',
      name: 'math',
    },
  ],
})

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [skills({ registry })],
})
```

## API

### `skills(options?)`

Creates an Apeira plugin that:

- Injects available skill metadata into the system prompt via `extendInstructions`
- Provides a `skill` tool for the model to load skill content
- Optionally provides a `skill_reference` tool for reference files
- Supports `refresh: 'turn'` to reload skills from the host before each turn

### `createSkillsRegistry(options?)`

Creates a host-owned registry for managing skill definitions. The host owns loading — the plugin has no direct filesystem access.

### `Skill`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique skill identifier |
| `description` | `string` | Shown to the model for skill selection |
| `content` | `string` | Full instruction content |
| `filePath` | `string` | Source location (for reference resolution) |
| `references?` | `SkillReference[]` | Reference file manifests |
| `disableModelInvocation?` | `boolean` | Prevents model from invoking this skill |
| `source?` | `string` | Origin metadata for the host |

### `SkillsRegistryOptions`

| Option | Type | Description |
|--------|------|-------------|
| `skills` | `Skill[]` | Static skill list |
| `loadSkills` | `() => Skill[] \| SkillsRegistrySnapshot` | Dynamic skill loader |
| `loadSkillReference` | `(skill, path) => SkillReference` | Lazy reference loader |
| `diagnostics` | `SkillDiagnostic[]` | Warnings for the host |

## Features

- **Model invocation** — the model chooses when to load a skill via the `skill` tool
- **Reference system** — skills can reference external files loaded lazily
- **Refresh modes** — `manual` (default) or `turn` (reload before each turn)
- **No filesystem coupling** — the host owns all I/O; perfect for sandboxed environments
