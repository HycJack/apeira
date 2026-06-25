# @apeira/plugin-hitl — Human-in-the-Loop

## 1. 定位

`@apeira/plugin-hitl` 为 Apeira Agent 提供**人在回路（Human-in-the-Loop）工具审批**能力。当 Agent 需要执行高风险操作时，插件拦截工具调用，将审批请求发送给人类用户，等待批准后才放行。

```
Agent 调用工具 → hitl 拦截 → 发送审批请求 → 用户批准/拒绝 → 继续/阻止执行
```

**应用场景**：部署代码、修改数据库、执行 rm -rf、发送邮件等需要人工确认的操作。

**依赖**：`@xsai/shared-chat` — 共享聊天消息类型，用于构造审批请求的 chat completion 消息。

## 2. 核心概念

### 2.1 审批模型

```
tool.pending        ← 审批请求已发送，等待用户响应
tool.approved       ← 用户批准，工具继续执行
tool.rejected       ← 用户拒绝，工具不执行，返回拒绝原因
tool.timeout        ← 超时未响应，按默认策略处理
```

### 2.2 审批策略

| 策略 | 行为 |
|------|------|
| `always` | 所有工具调用都需要审批 |
| `blocklist` | 黑名单模式：名单内的工具需要审批 |
| `allowlist` | 白名单模式：只有名单内的工具可以直接执行 |

### 2.3 超时策略

| 超时策略 | 行为 |
|---------|------|
| `reject` | 超时后拒绝执行 |
| `approve` | 超时后自动批准（适合低风险操作） |
| `skip` | 超时后跳过该工具，继续后续调用 |

## 3. 架构

```
@apeira/plugin-hitl
  │
  └── plugin (index.ts)  ← AgentPlugin 入口
      │
      ├── init() → 注册审批处理器
      ├── extendTools() → 包装工具 → tool guard 注入
      ├── onToolCall() → 拦截工具调用 → 审批流程
      └── onTurnFinish() → 清理本次 Turn 的审批状态
```

**为什么不用 `extendTools` 加一个审批工具**：审批不是 Agent 自己调用的——是人类通过 UI 批准。这需要一个带外（out-of-band）通信机制，通过事件通道完成。

## 4. 插件模型

### 4.1 作为 AgentPlugin

```ts
const hitl = (options?: HitlPluginOptions): AgentPlugin
```

### 4.2 配置

```ts
interface HitlPluginOptions {
  /** 审批策略，默认 'blocklist' */
  strategy?: 'always' | 'blocklist' | 'allowlist'

  /** 需要审批的工具名列表（blocklist 或 allowlist 模式） */
  tools?: string[]

  /** 超时时间 (ms)，默认 300_000 (5 分钟) */
  timeout?: number

  /** 超时策略，默认 'reject' */
  timeoutStrategy?: 'reject' | 'approve' | 'skip'

  /** 自定义审批处理函数 */
  onApprovalRequest?: (
    request: ApprovalRequest
  ) => Promise<ApprovalResponse>
}
```

## 5. 审批流程

### 5.1 拦截与审批

```
Agent 生成 tool_call
  │
  ▼
hitl.onToolCall(toolCall, context)
  │
  ├── 判断是否需要审批
  │   ├── strategy='always' → 总是审批
  │   ├── strategy='blocklist' → toolCall.name in tools?
  │   └── strategy='allowlist' → toolCall.name not in tools?
  │
  ├── 不需要审批 → 放行，正常执行
  │
  └── 需要审批:
      │
      ├── 构造 ApprovalRequest
      │   ├── toolName: 工具名
      │   ├── toolArgs: 工具参数
      │   ├── turnId: 当前 Turn ID
      │   └── context: 对话上下文摘要
      │
      ├── 发送到审批通道
      │   ├── 有 onApprovalRequest → 调用自定义处理器
      │   └── 无 → 通过 AgentChannel 发出 pending_approval 事件
      │
      ├── 等待响应 (timeout)
      │   ├── approved → 放行，工具正常执行
      │   ├── rejected → 返回拒绝消息给 LLM
      │   └── timeout → 按 timeoutStrategy 处理
      │
      └── 记录审批结果到 Turn 状态
```

### 5.2 ApprovalRequest

```ts
interface ApprovalRequest {
  /** 唯一请求 ID */
  id: string

  /** 工具名称 */
  toolName: string

  /** 工具参数 */
  toolArgs: Record<string, unknown>

  /** 关联的 Turn ID */
  turnId: string

  /** 对话上下文（最近 N 条消息的摘要） */
  context: string

  /** 请求时间 */
  timestamp: number
}
```

### 5.3 ApprovalResponse

```ts
interface ApprovalResponse {
  /** 对应请求 ID */
  requestId: string

  /** 审批决定 */
  decision: 'approved' | 'rejected'

  /** 拒绝理由（rejected 时可选） */
  reason?: string

  /** 修改后的参数（批准但想修改参数时） */
  modifiedArgs?: Record<string, unknown>
}
```

## 6. 事件通信

### 6.1 事件定义

```ts
// Agent → UI: 请求审批
channel.emit('hitl:pending', request: ApprovalRequest)

// UI → Agent: 用户批准
channel.emit('hitl:approved', response: ApprovalResponse)

// UI → Agent: 用户拒绝
channel.emit('hitl:rejected', response: ApprovalResponse)
```

### 6.2 在 React / Vue 中监听

```tsx
// 监听审批请求
agent.on('hitl:pending', (request) => {
  showApprovalDialog({
    title: `Approve tool: ${request.toolName}`,
    details: request.toolArgs,
    context: request.context,
    onApprove: () => agent.emit('hitl:approved', {
      requestId: request.id,
      decision: 'approved',
    }),
    onReject: (reason) => agent.emit('hitl:rejected', {
      requestId: request.id,
      decision: 'rejected',
      reason,
    }),
  })
})
```

## 7. 工具结果包装

### 7.1 工具执行前后

```
正常流程:
  LLM → tool_call → execute → tool_result → LLM

hitl 流程:
  LLM → tool_call → [审批] → execute → tool_result → LLM
                              └── rejected → rejection_message → LLM
```

### 7.2 拒绝消息格式

当工具被拒绝时，注入一条 tool result 到对话中：

```ts
{
  role: 'tool',
  tool_call_id: tc.id,
  content: `Tool "${tc.name}" was rejected by the user.` +
    (reason ? ` Reason: ${reason}` : ''),
}
```

LLM 收到拒绝消息后可以：
- 向用户解释被拒绝的原因
- 尝试不同的工具或参数
- 请求用户反馈替代方案

## 8. 与 plugin-compact 的关系

`hitl` 和 `compact` 在 Turn 生命周期中的位置不同：

```
Turn 开始
  │
  ├── compact.onTurnStart()     ← 恢复摘要上下文
  │
  ├── LLM 推理
  │   ├── 生成 tool_call
  │   ├── hitl.onToolCall()     ← HITL 拦截
  │   ├── 执行工具
  │   └── ...继续推理
  │
  ├── compact.onTurnFinish()    ← 压缩上下文
  └── hitl.onTurnFinish()       ← 清理审批状态
```

两者不冲突：compact 管 Token 预算，hitl 管安全审批。

## 9. 使用示例

### 基本使用 — 黑名单模式

```ts
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'
import { hitl } from '@apeira/plugin-hitl'

const agent = createAgent({
  runner: chat({ model: 'gpt-4o' }),
  plugins: [
    hitl({
      strategy: 'blocklist',
      tools: ['bash', 'write', 'edit'], // 这些需要审批
      timeout: 120_000,                 // 2 分钟超时
    }),
  ],
})
```

### 全部审批

```ts
hitl({
  strategy: 'always',
  timeoutStrategy: 'reject',  // 超时拒绝
})
```

### 自定义审批处理器

```ts
hitl({
  strategy: 'blocklist',
  tools: ['bash'],
  onApprovalRequest: async (req) => {
    // 发送到企业微信 / Slack / 邮件
    await sendSlackMessage(req)
    const decision = await waitForSlackResponse(req.id)
    return { requestId: req.id, decision }
  },
})
```

### 白名单模式

```ts
hitl({
  strategy: 'allowlist',
  tools: ['read', 'search', 'fetch'],  // 只有这些可以直接执行
})
```

## 10. 设计原则

1. **默认安全** — 不配置时不对任何工具启用审批（`blocklist` + 空列表 = 无拦截），避免误阻碍。显式配置后才生效
2. **非侵入** — 工具本身的实现不用改，审批逻辑在插件层完成
3. **事件驱动** — 审批通信走 AgentChannel，不耦合特定 UI 框架
4. **可超时** — 任何审批都有超时保障，防止 Agent 永远挂起
5. **可审计** — 所有审批请求和结果都记录在 Turn 状态中
6. **LLM 可见** — 拒绝消息作为 tool result 注入，LLM 可以理解和响应用户的拒绝
