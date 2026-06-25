# Apeira Plugin 机制详解

## 目录

1. [概述](#1-概述)
2. [AgentPlugin 接口](#2-agentplugin-接口)
3. [插件注册与规范化](#3-插件注册与规范化)
4. [enforce 排序机制](#4-enforce-排序机制)
5. [Hook 详解](#5-hook-详解)
6. [Hook 链组合策略](#6-hook-链组合策略)
7. [AgentEntry 扩展 — module augmentation](#7-agententry-扩展----module-augmentation)
8. [三个真实插件剖析](#8-三个真实插件剖析)
9. [完整生命周期时间线](#9-完整生命周期时间线)
10. [设计原则总结](#10-设计原则总结)

---

## 1. 概述

Apeira 的插件系统是一套**声明式 Hook 模型**。插件不直接调用 LLM、不管理队列、不持有 Agent 引用——它们只是声明"我在某个时刻要做某件事"，由 Core 在正确的时机调用。

```
插件 ≈ 纯函数/纯对象 + Hook 声明
```

核心约束：

- **插件不感知 Runner**：Plugin 修改 Runner 的参数，但不直接调用 Runner
- **插件不拥有 Agent**：Agent 在 `init()` 时将自己注入给插件，但插件不能存储为长期状态（stop 时必须清除）
- **Hook 之间无状态共享**：每个 hook 独立执行，不共享 mutable 状态
- **错误隔离**：单个 hook 失败不影响其他 hook，不影响 Agent 运行

---

## 2. AgentPlugin 接口

```ts
interface AgentPlugin {
  // ===== 元数据 =====
  name: string                   // 唯一标识，如 '@apeira/plugin-compact'
  version?: string               // 语义化版本
  enforce?: 'pre' | 'post'       // 排序权重，见第 4 节

  // ===== 生命周期 Hooks =====
  init?: (agent: Agent) => MaybePromise<void>
  stop?: () => MaybePromise<void>

  // ===== Turn 级 Hooks =====
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  transformEntries?: (
    entries: readonly AgentEntry[],
    options: TransformEntriesOptions
  ) => MaybePromise<readonly AgentEntry[]>
  onTurnFinish?: (options: TurnFinishOptions) => MaybePromise<void>

  // ===== Step 级 Hooks =====
  prepareStep?: PrepareStep
  preToolCall?: PreToolCall
  postToolCall?: PostToolCall
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
}
```

每个 hook 都是**可选的**。一个插件可以只实现其中一个 hook（如 `commonTools` 只实现 `extendTools`），也可以实现多个（如 `compact` 实现了 `init`、`onTurnFinish`、`transformEntries`、`stop`）。

---

## 3. 插件注册与规范化

### 3.1 注册

```ts
const agent = createAgent({
  plugins: [compact(), hitl(), commonTools()],
})
```

### 3.2 规范化 — normalizePlugins

用户传入的 `plugins` 数组可以是嵌套的、包含 falsy 值的：

```ts
type AgentPluginOption =
  | AgentPlugin
  | AgentPluginOption[]  // 支持嵌套
  | false | null | undefined  // 支持条件禁用
```

`normalizePlugins()` 在 `createAgent` 时调用，递归展平：

```ts
normalizePlugins([
  compact(),
  [hitl(), commonTools()],   // 嵌套数组展平
  prod ? mcp({...}) : false, // 条件禁用
])
// → [compactPlugin, hitlPlugin, commonToolsPlugin]
// (mcp 在 dev 环境被过滤掉)
```

这使得用户可以用数组组织插件、用三元表达式条件加载。

### 3.3 Hook 预绑定

```ts
// createAgent 内部
const hooks = {
  extendInstructions: chainExtendInstructions(plugins),
  extendTools: chainExtendTools(plugins),
  transformEntries: chainTransformEntries(plugins),
  prepareStep: mergePrepareStep(plugins),
  preToolCall: somePreToolCall(plugins),
  postToolCall: somePostToolCall(plugins),
  onTurnFinish: everyOnTurnFinish(plugins),
  onFinish: everyOnFinish(plugins),
}
```

**关键设计**：Hook 链在 `createAgent` 时构建完成，后续 Turn 执行时只需调用已装配好的函数。这避免了每个 Turn 都重新遍历插件列表。

---

## 4. enforce 排序机制

```ts
enforce: 'pre'   → order = 0  (最先执行)
enforce: undefined → order = 1 (默认，中间)
enforce: 'post'  → order = 2  (最后执行)
```

### 4.1 示例

```ts
plugins: [
  { name: 'A', enforce: 'post' },   // order=2 → 最后
  { name: 'B' },                     // order=1 → 中间
  { name: 'C', enforce: 'pre' },    // order=0 → 最先
]
```

执行顺序：C → B → A

### 4.2 为什么需要 enforce

考虑 `transformEntries` 的场景：

```
原始 entries: [msg1, msg2, msg3, ..., msg100]
  │
  ▼ compact (enforce: 'pre')
  │  替换为: [summary(1-90), msg91, ..., msg100]
  │
  ▼ some-other-plugin (enforce: undefined)
     基于精简后的 entries 再做处理
```

压缩插件应该在"整理插件"之前执行——它先减少数据量，其他插件在精简后的数据上工作。`enforce: 'pre'` 保证了这一点。

---

## 5. Hook 详解

### 5.1 init(agent)

**调用时机**：`agent.init()` 时，在恢复存储和状态**之后**。

**用途**：
- 获取 Agent 引用（用于后续 hook 中访问 state / storage / runner）
- 订阅事件（如 skills 的 `refresh: 'turn'` 订阅 `turn.start`）

**约束**：
- 不能抛出错误阻断 Agent 初始化（错误被 catch 并 warn）
- `stop()` 时必须清除 Agent 引用

```ts
// compact 的 init
init: (nextAgent) => {
  agent = nextAgent  // 保存引用，供 onTurnFinish 使用
}

// skills 的 init
init: (agent) => {
  if (refreshMode === 'turn') {
    unsubscribe = agent.subscribe('apeira', (event) => {
      if (event.type === 'turn.start')
        void skillSet.refresh()  // 每个 Turn 前刷新技能
    })
  }
}
```

### 5.2 stop()

**调用时机**：`agent.stop()` 时。

**用途**：清理 init 中创建的资源——取消订阅、清除引用、关闭连接。

```ts
stop: () => {
  agent = undefined  // compact
  unsubscribe?.()    // skills
}
```

### 5.3 extendInstructions(options)

**调用时机**：每次 Runner 调用前（即 LLM API 调用前）。

**参数**：
```ts
interface ExtendOptions {
  state: Readonly<AgentStateManager>  // 当前状态
  // 其他上下文...
}
```

**返回值**：`string | void | Promise<string | void>`

**用途**：向系统提示追加内容。

**组合方式**：串联。所有插件的返回值用 `\n\n` 拼接。

```ts
// skills 的 extendInstructions
extendInstructions: ({ state }) => {
  const budget = Math.floor((state.contextLength ?? 128_000) * 0.02)
  return formatSkillsForSystemPrompt(skills, budget)
  // → "<available_skills>\n  <skill>...</skill>\n</available_skills>"
}
```

**最终系统提示的结构**：
```
[用户配置的 instructions]

[插件 A 的 extendInstructions]
[插件 B 的 extendInstructions]
[插件 C 的 extendInstructions]
```

### 5.4 extendTools(options)

**调用时机**：每次 Runner 调用前。

**返回值**：`Tool[] | void | Promise<Tool[] | void>`

**用途**：向 Agent 注册工具。

**组合方式**：串联。所有插件的返回值压平到一个数组。

```ts
// commonTools 的 extendTools
extendTools: async () => {
  return Promise.all(
    TOOL_FACTORIES
      .filter(({ name }) => !skips.has(name))  // include/exclude 筛选
      .map(async ({ factory }) => factory())    // 创建工具
  )
}
// → [readTool, writeTool, editTool, bashTool, fetchTool, searchTool]
```

### 5.5 transformEntries(entries, options)

**调用时机**：每次 Runner 调用前，在 `extendInstructions` 和 `extendTools` **之后**。

**参数**：
```ts
interface TransformEntriesOptions {
  state: Readonly<AgentStateManager>
  // ...
}
```

**返回值**：`readonly AgentEntry[] | Promise<readonly AgentEntry[]>`

**用途**：修改或替换传递给 LLM 的历史条目。这是最强大的 hook——可以增删改查任何历史记录。

**组合方式**：管道串联。每个插件的输出是下一个插件的输入。

```ts
// compact 的 transformEntries
transformEntries: (entries) => {
  // 找到最近的 compact entry
  const compactIndex = entries.findLastIndex(e => e.type === 'compact')

  // 将 compact 数据展开为 developer 消息（摘要）
  const summaryEntry = entry(
    'input',
    developer(`<context_summary>\n${compactData.summary}\n</context_summary>`)
  )

  // 用摘要替换被压缩的原始条目，保留最近的消息
  return [
    summaryEntry,
    ...lastSummarizedIndex之后的条目,
    ...compactIndex之后的条目,
  ]
}
```

**数据流**：
```
Storage 中的原始 entries (100 条)
  │
  ▼ plugin-A.transformEntries()
  │  → 修改后 entries (80 条)
  │
  ▼ plugin-B.transformEntries()
  │  → 修改后 entries (80 条)
  │
  ▼ toAgentInput()
  │  → AgentInput[] (输入给 LLM)
```

### 5.6 prepareStep()

**调用时机**：每个 LLM step 开始前。

```ts
type PrepareStep = (step: StepContext) => MaybePromise<PrepareStepResult | void>

interface PrepareStepResult {
  additionalInstructions?: string  // 追加到本轮指令
  tools?: Tool[]                   // 追加工具
}
```

**组合方式**：合并。多个插件的 result 做浅合并（后面的覆盖前面的同名字段）。

### 5.7 preToolCall / postToolCall

**调用时机**：工具调用前后。

```ts
type PreToolCall = (
  toolCall: ToolCall,
  context: ToolCallContext
) => MaybePromise<ToolCall | void>

type PostToolCall = (
  result: ToolResult,
  context: ToolCallContext
) => MaybePromise<ToolResult | void>
```

**组合方式**：`some`（短路）。任一返回非 undefined 则停止链。

**用途**：
- `preToolCall`：修改参数、添加审批（hitl）、注入上下文
- `postToolCall`：修改结果、添加元数据、触发副作用

### 5.8 onTurnFinish(options)

**调用时机**：一个 Turn 完成后。

```ts
interface TurnFinishOptions {
  turnId: string
  usage?: Usage     // { totalTokens, promptTokens, completionTokens }
  // ...
}
```

**用途**：Turn 级别的收尾工作——压缩上下文、更新统计、发送通知。

**组合方式**：`every`（全部执行，不短路）。

```ts
// compact 的 onTurnFinish
onTurnFinish: async (turn) => {
  // 1. 检查是否需要压缩
  if (turn.usage.totalTokens < contextLength * threshold)
    return  // 还没到阈值，不压缩

  // 2. 读取全部历史
  const entries = await storage.read()

  // 3. 确定需要压缩的范围
  const entriesToSummarize = entries.slice(0, cutoffIndex)

  // 4. 创建临时 Agent 生成摘要
  const summary = await executeCompact({
    compactAgent: { instructions, runner },
    input: toAgentInput(entriesToSummarize),
  })

  // 5. 将摘要写入存储（作为 compact entry）
  await storage.append(entry('compact', { lastEntryId, summary }))
}
```

### 5.9 onStepFinish(step) / onFinish(step?)

**调用时机**：
- `onStepFinish`：每个 LLM step 完成时（LLM 返回一次响应 = 一个 step）
- `onFinish`：Runner 完全结束时（可能多个 step 之后）

**组合方式**：`every`（全部执行）。

---

## 6. Hook 链组合策略

| Hook | 组合策略 | 签名 | 行为 |
|------|---------|------|------|
| `extendInstructions` | **串联** | `(string \| void)[] → string` | 所有返回值用 `\n\n` join |
| `extendTools` | **串联** | `(Tool[] \| void)[] → Tool[]` | 所有返回值 flat |
| `transformEntries` | **管道** | `entries → entries → entries` | 前一个输出 = 后一个输入 |
| `prepareStep` | **合并** | `(result \| void)[] → result` | Object.assign，后者覆盖前者 |
| `preToolCall` | **some** | `(result \| void) → result` | 第一个非 void 即短路 |
| `postToolCall` | **some** | `(result \| void) → result` | 同上 |
| `onTurnFinish` | **every** | `void[]` | 全部执行 |
| `onStepFinish` | **every** | `void[]` | 全部执行 |
| `onFinish` | **every** | `void[]` | 全部执行 |
| `init` | **every** | `void[]` | 全部执行，错误不中断 |
| `stop` | **every** | `void[]` | 全部执行，错误不中断 |

### 为什么不同 hook 用不同策略

- **`some`（短路）用于 preToolCall / postToolCall**：工具调用拦截是高优先级操作——一旦某插件处理了（如 hitl 审批），其他插件不需要再介入。

- **`管道`用于 transformEntries**：条目转换有先后关系——先压缩再过滤，顺序不对结果就错。

- **`every`用于生命周期事件**：多个插件各自独立收尾（compact 压缩、hitl 清状态），互不干扰。

- **`串联`用于 extend***：多个插件各自贡献一段 instructions 或几个 tools，简单拼接即可。

---

## 7. AgentEntry 扩展 — module augmentation

插件可以扩展 Apeira 的存储类型系统，使其能写入自定义条目。

### 7.1 核心机制：TypeScript module augmentation

```ts
// @apeira/core 中声明
interface AgentCustomEntry {}  // 空接口，等待扩展

type AgentEntry<T extends keyof AgentCustomEntry = keyof AgentCustomEntry> = {
  data: AgentCustomEntry[T]
  id: string
  parentId?: string
  timestamp: number
  type: T
}
```

插件在自己的代码中扩展 `AgentCustomEntry`：

```ts
// plugin-compact 中
declare module '@apeira/core' {
  interface AgentCustomEntry {
    compact: CompactEntry  // 新增 'compact' 类型
  }
}

interface CompactEntry {
  lastEntryId?: string     // 最后一个被摘要的条目 ID
  summary: string          // 摘要文本
}
```

之后就可以写入和读取 compact 条目：

```ts
// 写入
await storage.append(entry('compact', { lastEntryId, summary }))
// → AgentEntry<'compact'> 类型安全

// 读取 + 类型守卫
const entries = await storage.read()
const compactEntry = entries.findLast(e => e.type === 'compact')
// → AgentEntry<'compact'> | undefined 正确的类型推断
```

### 7.2 为什么用 module augmentation 而不是泛型

如果 `AgentEntry` 用泛型参数化，每个包都要传递类型参数——`Agent<'compact' | 'custom'>`——类型会爆炸。Module augmentation 让每个插件独立声明自己的 entry 类型，TypeScript 编译器自动合并。

### 7.3 已有的扩展

| 包 | 扩展的 entry type | 用途 |
|----|-------------------|------|
| `@apeira/core` | `'input'`, `'state'`, `'event'` | 内置三种基础类型 |
| `@apeira/plugin-compact` | `'compact'` | 存储压缩摘要 |

---

## 8. 三个真实插件剖析

### 8.1 plugin-common-tools — 最简插件

```ts
export const commonTools = (options = {}): AgentPlugin => ({
  extendTools: async () => { /* 创建 6 个工厂工具 */ },
  name,
  version,
})
```

**只用了 `extendTools`**。无 init、无 stop、无状态。最纯粹的"只加工具"型插件。

**设计要点**：
- `include` / `exclude` 互斥（TypeScript union 保证）
- 工具创建延迟到 `extendTools`（而非 init），每次 Turn 重新创建——因为工具是无状态的纯函数，重新创建零成本
- 不污染 instructions、不修改状态、不参与 Turn 生命周期

### 8.2 plugin-compact — 状态驱动插件

```ts
export const compact = (options): AgentPlugin => ({
  init: (agent) => { agent = agent },            // 保存引用
  onTurnFinish: async (turn) => { ... },         // 触发压缩
  transformEntries: transformCompactEntries,      // 替换历史
  stop: () => { agent = undefined },              // 清理引用
  name,
  version,
})
```

**用了 4 个 hook**。完整的 init → runtime → stop 生命周期。

**数据流**：

```
Turn 完成
  │
  ▼ onTurnFinish
  │  检查 usage.totalTokens > contextLength * 0.9
  │  → 创建临时 Agent → 调用 LLM 生成 5 维摘要
  │  → storage.append(entry('compact', { summary, lastEntryId }))
  │
  ▼ 下一个 Turn
  │  transformEntries 被调用
  │  → 找到 compact entry
  │  → 用 summary 替换被压缩的原始条目
  │  → 保留最近 preserveEntries 条消息
  │
  ▼ LLM 收到精简后的上下文
```

**容错设计**：

```
正常压缩 → 失败 → 静默重试 (最多 3 次) → 仍失败 → HARD_TRUNCATION_MESSAGE
                                              "(Earlier conversation omitted due to length)"
```

每次成功后重置失败计数。避免因为 LLM 偶尔不稳定导致永久降级。

### 8.3 plugin-skills — 事件驱动插件

```ts
export const skills = (options = {}): AgentPlugin => ({
  extendInstructions: ({ state }) => formatSkillsForSystemPrompt(...),
  extendTools: async () => [skillTool, skillReferenceTool],
  init: (agent) => {
    // 监听 turn.start → 刷新 SkillSet
    agent.subscribe('apeira', (event) => {
      if (event.type === 'turn.start') skillSet.refresh()
    })
  },
  stop: () => { unsubscribe?.() },
  name,
  version,
})
```

**用了 4 个 hook**。唯一使用 AgentChannel 事件订阅的插件。

**刷新模式**：

| refresh | 行为 |
|---------|------|
| `'turn'` | init 中订阅 `turn.start` → `skillSet.refresh()` |
| `'manual'` | 不订阅，只加载一次 |

`'turn'` 模式实现热重载：编辑 SKILL.md → 下一个 Turn 自动生效，无需重启 Agent。

---

## 9. 完整生命周期时间线

```
createAgent()
│
├── normalizePlugins()          ← 展平嵌套、过滤 falsy
├── 按 enforce 排序
├── 预绑定 Hook 链              ← 链式函数在此时构建
├── 创建 AgentChannel
├── 创建 AgentStateManager
├── 创建 AgentQueue
│
▼
agent.init()
│
├── 从 storage 恢复 entries
├── 从 storage 恢复 state (静默)
├── 调用 plugin-A.init(agent)   ← 插件获得 Agent 引用
├── 调用 plugin-B.init(agent)
├── ...（错误不中断）
│
▼
agent.send('Hello')
│
├── turn.queued (事件)
├── turn.start (事件)
│   ├── skills 监听到 → skillSet.refresh()
│
├── 构建 Runner 参数:
│   │
│   ├── instructions = 基础 instructions
│   │   + plugin-A.extendInstructions()
│   │   + plugin-B.extendInstructions()
│   │   + ...
│   │
│   ├── tools = 内置 tools
│   │   + plugin-A.extendTools()
│   │   + plugin-B.extendTools()
│   │   + ...
│   │
│   ├── entries = storage.read()
│   │   → plugin-A.transformEntries(entries)
│   │   → plugin-B.transformEntries(entries)
│   │   → toAgentInput(entries)  ← 转为 LLM 可读格式
│   │
│   ├── prepareStep = merge(
│   │     plugin-A.prepareStep(),
│   │     plugin-B.prepareStep(),
│   │   )
│   ├── preToolCall = some(plugin-A.preToolCall, plugin-B.preToolCall)
│   └── postToolCall = some(plugin-A.postToolCall, plugin-B.postToolCall)
│
├── Runner 执行
│   │
│   ├── LLM API 调用
│   │
│   ├── LLM 返回 tool_call
│   │   ├── preToolCall(toolCall) → [修改/拦截]
│   │   ├── 执行工具
│   │   ├── postToolCall(result) → [修改/记录]
│   │   └── 结果注入上下文，继续推理
│   │
│   ├── LLM 返回最终响应
│   │   ├── onStepFinish(step)  ← 每个 step
│   │   └── onFinish(step)      ← Runner 完成
│   │
│   └── Runner 返回 { output, usage }
│
├── 持久化 input + output entries
├── turn.done (事件)
├── plugin-A.onTurnFinish(turn)
├── plugin-B.onTurnFinish(turn)
│
▼
agent.stop()
│
├── plugin-A.stop()
├── plugin-B.stop()
├── ...（错误不中断）
└── 断开存储
```

---

## 10. 设计原则总结

1. **声明式**：插件只声明 hook，不关心调用时机和调用方式。Core 负责编排。

2. **无状态倾向**：鼓励插件无状态。需要状态时（如 compact 的 `agent` 引用），必须在 `stop` 中清理。

3. **错误不传播**：
   - `init` 中某插件抛错 → warn + 继续初始化其他插件
   - `stop` 中某插件抛错 → warn + 继续清理其他插件
   - `extend*` 中某插件抛错 → 该插件的贡献被视为空，其他插件正常
   - `onTurnFinish` 中某插件抛错 → warn + 继续执行其他插件

4. **Hook 链预绑定**：链在 `createAgent` 时构建，Turn 执行时不需要遍历插件列表。这是性能优化——高频场景（流式 LLM 调用）中减少函数调用开销。

5. **类型安全扩展**：Module augmentation 让插件可以在不修改 Core 源码的情况下扩展存储类型。

6. **Runner 无关**：插件的 hook 签名不暴露任何 Runner 细节。同一个插件可以在 chat runner、responses runner、自定义 runner 中使用，无需修改。

7. **排序可控**：`enforce: 'pre' | 'post'` 给予插件开发者对执行顺序的控制权，而不是依赖注册顺序。
