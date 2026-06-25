# @apeira/plugin-mcp — Model Context Protocol Integration

## 1. 定位

`@apeira/plugin-mcp` 是 Apeira 对 **Model Context Protocol (MCP)** 的插件适配层。它将 MCP 服务端暴露的工具、资源和提示模板转换为 Apeira Agent 可用的原生工具，使 Agent 能无缝接入 MCP 生态。

```
MCP Server (外部) → MCP Client (插件内) → Apeira Tool → Agent
```

**核心价值**：Apeira Agent 不需要理解 MCP 协议——插件负责连接、发现、转换和生命周期管理。一个插件可以连接多个 MCP Server。

**依赖**：`@modelcontextprotocol/sdk` — 官方 MCP TypeScript SDK，负责协议握手、传输层和类型定义。

## 2. MCP 背景

MCP 是 Anthropic 提出的开放协议，标准化了 LLM 应用与外部工具/数据源之间的通信。协议定义了三种原语：

| 原语 | 说明 | Apeira 映射 |
|------|------|-------------|
| **Tool** | 可调用的函数（有输入 schema） | → Apeira Tool |
| **Resource** | 可读取的数据（文件、数据库记录等） | → 资源读取工具 |
| **Prompt** | 可复用的提示模板 | → 按需注入 instructions |

## 3. 架构

```
@apeira/plugin-mcp
  │
  ├── plugin (index.ts)     ← AgentPlugin 入口
  │   ├── init() → 初始化 MCP 客户端 + 连接
  │   ├── extendTools() → 发现 + 注册 MCP 工具
  │   ├── extendInstructions() → 注入资源/Prompt 说明
  │   └── onDispose() → 断开 MCP 连接
  │
  ├── client.ts              ← MCP 客户端管理
  │   ├── 连接生命周期
  │   ├── 工具发现 (listTools)
  │   ├── 资源发现 (listResources)
  │   └── Prompt 发现 (listPrompts)
  │
  └── adapters/              ← MCP → Apeira 转换
      ├── tool.ts            ← MCP Tool → Apeira Tool
      ├── resource.ts        ← MCP Resource → Apeira Tool (read)
      └── prompt.ts          ← MCP Prompt → instructions 片段
```

## 4. 插件模型

### 4.1 作为 AgentPlugin

```ts
const mcp = (options: McpPluginOptions): AgentPlugin
```

### 4.2 配置

```ts
interface McpPluginOptions {
  /** MCP Server 配置列表 */
  servers: McpServerConfig[]

  /** 工具名前缀，默认 'mcp_' (避免与内置工具冲突) */
  toolPrefix?: string

  /** 是否自动重连，默认 true */
  autoReconnect?: boolean

  /** 重连间隔 (ms)，默认 5000 */
  reconnectInterval?: number

  /** 最大重连次数，默认 3 (0 = 无限) */
  maxReconnects?: number

  /** 工具调用超时 (ms)，默认 30_000 */
  toolTimeout?: number
}
```

### 4.3 传输层配置

```ts
type McpServerConfig =
  | StdioServerConfig
  | SSEServerConfig
  | StreamableHTTPServerConfig

interface StdioServerConfig {
  type: 'stdio'
  /** MCP Server 可执行文件路径 */
  command: string
  /** 命令行参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** Server 名称（用于日志和工具命名空间） */
  name?: string
}

interface SSEServerConfig {
  type: 'sse'
  /** SSE 端点 URL */
  url: string
  /** 可选请求头 */
  headers?: Record<string, string>
  name?: string
}

interface StreamableHTTPServerConfig {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
  name?: string
}
```

**三种传输方式对应 MCP 规范**：
- `stdio` — 子进程 stdin/stdout（本地工具最常用）
- `sse` — Server-Sent Events（远程 HTTP 服务）
- `streamable-http` — HTTP 流式传输（新规范，替代 SSE）

## 5. 工具发现与注册

### 5.1 初始化流程

```
plugin.init()
  │
  ├── 对每个 server config:
  │   ├── 创建传输层 (StdioClientTransport / SSEClientTransport)
  │   ├── 创建 Client(session) → client.connect(transport)
  │   ├── 握手 (initialize + initialized)
  │   └── 注册能力回调 (tools/list, resources/list, prompts/list)
  │
  └── 缓存所有发现的能力
```

### 5.2 extendTools — 工具注册

```
extendTools()
  │
  ├── 对每个已连接的 server:
  │   ├── client.listTools() → MCP Tool[]
  │   └── 对每个 MCP Tool:
  │       ├── 转换为 Apeira Tool
  │       │   ├── name = toolPrefix + server.name + '_' + tool.name
  │       │   │   例: 'mcp_filesystem_read_file'
  │       │   ├── description = tool.description
  │       │   ├── parameters = tool.inputSchema (JSON Schema)
  │       │   └── execute = (args) → client.callTool(tool.name, args)
  │       │
  │       └── 注册到 tools[]
  │
  └── 对每个已连接的 server (可选):
      ├── client.listResources() → MCP Resource[]
      └── 注册一个统一的资源读取工具
          └── name = toolPrefix + server.name + '_read_resource'
          └── execute(uri) → client.readResource(uri)
```

### 5.3 工具名命名规范

```
{toolPrefix}{serverName}_{toolName}

示例:
  mcp_filesystem_read_file     ← stdio filesystem server
  mcp_github_search_repos      ← streamable-http github server
  mcp_postgres_query           ← stdio postgres server
```

`toolPrefix` 默认为 `mcp_`，确保不与内置工具（read/write/bash 等）冲突。

## 6. 工具执行

### 6.1 执行流程

```
Agent 调用 mcp_filesystem_read_file({ path: '/etc/config.json' })
  │
  ▼
Apeira Tool execute(args)
  │
  ├── 找到对应的 MCP Server (通过 tool name 映射)
  ├── 检查连接状态 → 断线则尝试重连
  │
  ├── client.callTool(originalToolName, args, { timeout })
  │   │
  │   ├── 构造 JSON-RPC tools/call 请求
  │   ├── 通过传输层发送
  │   └── 等待响应
  │
  └── 返回结果
      ├── content[] → 拼接为文本
      └── isError → 如为 true，包装为错误消息
```

### 6.2 超时处理

`toolTimeout` 默认 30 秒。超时时返回错误消息给 LLM：

```
"MCP tool 'filesystem_read_file' timed out after 30s. The server may be overloaded."
```

### 6.3 错误映射

| MCP 端错误 | Agent 端行为 |
|-----------|-------------|
| Server 未连接 | 自动重连 + 重试一次 |
| Tool 未找到 | 返回错误消息 |
| 参数校验失败 | 返回校验错误详情 |
| 执行异常 (isError=true) | 返回错误内容给 LLM |

## 7. 自动重连

```
工具调用时发现连接断开
  │
  ├── autoReconnect=false → 直接返回错误
  │
  └── autoReconnect=true:
      ├── 检查重连次数 < maxReconnects
      ├── 等待 reconnectInterval
      ├── client.connect(transport) ← 重新握手
      ├── 成功 → 重试工具调用
      └── 失败 → 计数 +1，递归重试或放弃
```

## 8. Resource 和 Prompt 支持

### 8.1 Resource → 资源读取工具

MCP Resource 是服务器提供的数据源（文件内容、数据库记录、API 响应）。插件为每个 server 注册一个统一工具：

```ts
// 工具: mcp_{server}_read_resource
// 参数: { uri: string }
// 调用: client.readResource({ uri })
```

### 8.2 Prompt → 动态 Instructions

MCP Prompt 是可复用的提示模板。插件在 `extendInstructions` 中注入：

```ts
extendInstructions({ state }) {
  const prompts = getAllPrompts()
  if (prompts.length === 0) return

  return `
<available_mcp_prompts>
${prompts.map(p => `- ${p.name}: ${p.description}`).join('\n')}
</available_mcp_prompts>

To use a prompt, call the mcp_get_prompt tool with the prompt name.
`
}
```

同时注册一个 `mcp_get_prompt` 工具用于按需获取 prompt 内容。

## 9. 生命周期

```
createAgent()
  │
  ▼
plugin.init()
  ├── 连接所有 MCP Server
  ├── 握手 + 能力发现
  └── 缓存工具/资源/Prompt 列表
  │
  ▼
每个 Turn:
  ├── extendInstructions() → 注入 Prompt 清单
  └── extendTools() → 注册所有 MCP 工具
  │
  ▼
Agent 调用 MCP 工具
  ├── [可能触发重连]
  └── [exec + timeout]
  │
  ▼
agent.stop() / plugin.onDispose()
  └── 断开所有 MCP 连接 + 清理资源
```

## 10. 使用示例

### 基本使用 — 标准输入输出

```ts
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'
import { mcp } from '@apeira/plugin-mcp'

const agent = createAgent({
  runner: chat({ model: 'gpt-4o' }),
  plugins: [
    mcp({
      servers: [
        {
          type: 'stdio',
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
        },
      ],
    }),
  ],
})
```

### 多 Server 组合

```ts
mcp({
  servers: [
    {
      type: 'stdio',
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
    {
      type: 'stdio',
      name: 'postgres',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL!],
    },
    {
      type: 'streamable-http',
      name: 'github',
      url: 'https://api.github.com/mcp',
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    },
  ],
  toolPrefix: 'ext_',
  toolTimeout: 60_000,
})
```

### 工具名冲突处理

```ts
// 两个 server 都有 'search' 工具
// → mcp_docs_search 和 mcp_code_search
// 互不冲突
mcp({
  servers: [
    { type: 'stdio', name: 'docs', command: '...' },
    { type: 'stdio', name: 'code', command: '...' },
  ],
})
```

## 11. 与 plugin-common-tools 的关系

| | plugin-common-tools | plugin-mcp |
|---|---|---|
| 工具来源 | 内置实现 | 外部 MCP Server |
| 注册方式 | 代码中定义 | 运行时发现 |
| 扩展性 | 固定 6 工具 | 无限（取决于连接的 Server） |
| 安全性 | 直接执行 | 通过 MCP 协议沙箱化 |

两者互补：`commonTools` 提供基础开发工具，`mcp` 接入外部生态。

## 12. 设计原则

1. **协议透明** — Agent 不需要知道 MCP，只看到普通 Apeira Tool
2. **一个插件多个 Server** — 减少插件碎片化
3. **命名空间隔离** — `mcp_{server}_{tool}` 防止与内置工具冲突
4. **默认可靠** — autoReconnect + 超时 + 错误映射确保不会因 MCP Server 问题导致 Agent 卡死
5. **延迟工具注册** — 每次 Turn 调用 `extendTools`，支持 MCP Server 动态增删工具
6. **传输层无关** — 支持 stdio / SSE / streamable-http，代码基于 SDK 抽象接口
7. **类型安全** — MCP Tool JSON Schema → TypeScript 类型推断（通过 `@xsai/tool`）
