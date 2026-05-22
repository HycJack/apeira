# @apeira/plugin-mcp

Expose Model Context Protocol server tools to Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-mcp
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { mcp } from '@apeira/plugin-mcp'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    mcp({
      servers: {
        docs: {
          transportOptions: {
            requestInit: {
              headers: { Authorization: `Bearer ${process.env.DOCS_MCP_TOKEN}` },
            },
          },
          type: 'streamable-http',
          url: 'https://example.com/mcp',
        },
        filesystem: {
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          command: 'npx',
          type: 'stdio',
        },
      },
    }),
  ],
})
```

## API

### `mcp(options)`

Creates an Apeira plugin that converts MCP tools into `@xsai/tool` compatible function tools.

```ts
interface MCPPluginOptions {
  clientInfo?: { name?: string, version?: string }
  onError?: (error: unknown, context: MCPErrorContext) => unknown
  prefixToolNames?: boolean
  refreshTools?: 'manual' | 'turn'
  servers: Record<string, MCPServerConfig>
}
```

Supported server transports:

| Type | Use when |
|------|----------|
| `stdio` | Running a local MCP server process |
| `streamable-http` | Connecting to a Streamable HTTP MCP server |
| `sse` | Connecting to a legacy SSE MCP server |
| `custom` | Supplying your own MCP SDK transport |

Tool names are prefixed by default as `mcp_<serverId>__<toolName>` to avoid collisions with existing Apeira tools. Disable this with `prefixToolNames: false`, or provide `nameMapper` per server.

Server and tool name parts are sanitized for function-tool compatibility. If two names only differ by characters that sanitize to the same value, provide `nameMapper` to avoid collisions.

### Tool Filtering

```ts
mcp({
  servers: {
    github: {
      excludeTools: ['delete_repository'],
      includeTools: ['search_issues', 'get_issue'],
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    },
  },
})
```

Each server also accepts `toolFilter`, `callTimeoutMs`, `clientOptions`, and `nameMapper`.

### Lifecycle

Connections are lazy and persistent. The plugin connects to each server the first time tools are resolved, caches the listed tools by default, and reuses the MCP client for later tool calls.

Use `refreshTools: 'turn'` to re-list tools before each turn. Turn refreshes are isolated per server: if a refresh fails, the plugin keeps the previous tool cache for that server, or an empty cache when no previous tools exist. Set `callTimeoutMs` on slow servers and use `onError` to observe or convert failures.

### Errors

MCP tool results with `isError: true` are returned to the model as normal tool results. Transport, connection, protocol, and timeout failures throw by default.

Provide `onError` to observe or convert failures:

- For `callTool` errors, return a model-visible tool result. Returning `undefined` produces a default `{ isError: true, content: [...] }` result.
- For `connect` and `listTools` errors during tool discovery, return `Tool[]` to substitute tools or `undefined` to expose no tools for that server. Returning any other shape throws a `TypeError`.
