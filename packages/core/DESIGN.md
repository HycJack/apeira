# @apeira/core — Stream-First Agent Runtime

## 1. 定位

`@apeira/core` 是 Apeira 框架的**内核引擎**，提供 Agent 的完整运行时生命周期：创建、消息队列、插件系统、状态管理、存储抽象和事件流。

它不是某个 LLM 调用的薄封装，而是一套**通用的 Agent 运行时模型**——与具体的 API（Chat Completions / Responses）解耦，通过 Runner 抽象适配不同后端。

```
@apeira/core
  ├── createAgent()          ← Agent 工厂
  ├── AgentQueue (queue.ts)  ← 消息队列 + Turn 编排
  ├── AgentChannel           ← 事件总线
  ├── Plugin system          ← 插件生命周期
  ├── StateManager           ← 不可变状态管理
  ├── AgentStorage (接口)    ← 存储抽象
  └── Runner 抽象            ← LLM 调用适配
```

## 2. 核心概念：Agent

### 2.1 定义

```ts
interface Agent extends AgentChannel, AgentQueue {
  init: () => Promise<void>
  readonly initialInput: readonly AgentInput[]
  readonly initialState: Readonly<AgentState>
  readonly instructions: CreateAgentOptions['instructions']
  interrupt: (reason?: unknown) => Promise<string | undefined>
  readonly plugins: AgentPluginOption[]
  reset: () => Promise<void>
  readonly runner: Runner
  readonly state: Readonly<AgentStateManager>
  stop: () => Promise<void>
  readonly storage: AgentStorage
}
```

Agent 是**所有能力的汇聚点**：它同时是一个消息队列、一个事件通道、一个状态容器和一个存储客户端。

### 2.2 创建

```ts
const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: chat({ model: 'gpt-4o' }),
  storage: json({ path: './session.json' }),
  plugins: [compact(), hitl()],
})
```

`createAgent` 返回的 Agent **不会自动初始化**——调用方需显式调用 `await agent.init()`。

### 2.3 生命周期

```
createAgent()
  │
  ├── 构建 plugin hooks (提前绑定)
  ├── 创建 AgentChannel (事件总线)
  ├── 创建 AgentStateManager (状态)
  ├── 创建 AgentQueue (消息编排)
  │
  ▼
await agent.init()
  │
  ├── 从 storage 恢复 initialInput（如果存储为空）
  ├── 从 storage 恢复最新 state
  ├── 调用所有 plugin.init()
  │
  ▼
agent.send(input)  ← 进入运行循环
```

## 3. 架构分层

```
┌──────────────────────────────────────────────────────────┐
│                    用户代码                               │
│      agent.send() / agent.subscribe() / agent.wait()     │
├──────────────────────────────────────────────────────────┤
│                      Agent                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │  Queue   │  │ Channel  │  │   StateManager       │   │
│  │ (turn)   │  │ (events) │  │   (immutable)        │   │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘   │
│       │             │                   │               │
│       ▼             ▼                   ▼               │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  Plugin Pipeline                   │  │
│  │  init → extendInstructions → extendTools           │  │
│  │  → transformEntries → prepareStep → preToolCall    │  │
│  │  → postToolCall → onTurnFinish → onFinish → stop  │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│                         ▼                                │
│              ┌──────────────────┐                        │
│              │   Runner         │                        │
│              │ (chat/responses) │                        │
│              └────────┬─────────┘                        │
│                       │                                  │
│                       ▼                                  │
│              ┌──────────────────┐                        │
│              │ AgentStorage     │  ← 持久化               │
│              │ (mem/json/...)   │                        │
│              └──────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

## 4. AgentQueue — 消息队列与 Turn 编排

### 4.1 核心模型

Queue 是 Agent 的**心脏**，负责：

- **FIFO 排队**：多个 `send()` 调用按先进先出编排为 Turn
- **实时注入**：活跃 Turn 期间的新输入实时排入当前 Turn（而非创建新 Turn）
- **中断与恢复**：支持 abort / interrupt / clear

```ts
interface AgentQueue {
  send: (item: AgentInput, options?: AgentSignalOptions) => string
  wait: (options?: AgentSignalOptions) => Promise<void>
  abort: (reason?: unknown) => void
  clear: () => Promise<void>
  interrupt: (reason?: unknown) => string | undefined
  isIdle: () => boolean
  getActiveTurnId: () => string | undefined
}
```

### 4.2 Turn 模型

一个 **Turn** 由 `send()` 触发，Runner 执行，直到 LLM 停止输出。

```
Turn 生命周期:
  send() → turn.queued → turn.start → [event stream] → turn.done
                                                      → turn.failed
                                                      → turn.aborted
```

**实时注入**：如果 Turn 执行期间又有 `send()` 调用，输入不会创建新 Turn，而是排入 `pendingInput[]`。Runner 当前步骤完成后立即消费这些输入并继续执行：

```
send('a')         → Turn-1 开始执行
  send('b')       → pendingInput = ['b']
    Runner 完成当前步骤
    → turn.input_drained(count=1)
    → 继续执行，input = ['b']
      Runner 完成 → turn.done
```

### 4.3 实现细节

```ts
// 使用 yocto-queue (链式队列)
const pendingTurns = new Queue<AgentQueueTurn>()

// 每次 send 要么创建新 Turn，要么注入到活跃 Turn
send(item) {
  if (activeTurn) {
    pendingInput.push(item)     // 注入活跃 Turn
  } else {
    pendingTurns.enqueue(...)   // 创建新 Turn
    void pump()                 // 异步启动
  }
}

// pump 串行处理队列中的 Turn
pump() {
  for (const turn of pendingTurns.drain())
    await runTurn(turn)
}
```

**关键设计决策**：`yocto-queue` 而非数组。`Queue.drain()` 返回一个迭代器，边消费边释放内存，适合高频消息场景。

### 4.4 wait() — 空闲感知

```ts
await agent.wait()  // 阻塞直到所有 Turn 完成且队列为空
await agent.wait({ signal: AbortSignal.timeout(5000) })
```

实现通过 waiter 列表 + `notifyWaiters()` 在 `pump()` 完成后触发。

## 5. AgentChannel — 事件总线

### 5.1 核心模型

```ts
interface AgentChannel {
  emit: (channel, event, options?) => MaybePromise<void>
  subscribe: (channel, listener) => () => void  // 返回取消订阅函数
}
```

基于 **channel → Set<listener>** 的发布-订阅模型。

### 5.2 设计要点

- **多 channel 隔离**：插件监听 `apeira` channel，Runner 事件流也通过 `apeira` channel 发射
- **异步 listener**：支持 async listener，`emit` 会 await 所有 listener
- **错误隔离**：单个 listener 抛出异常不影响其他 listener
- **persist 回调**：`emit` 可选 `{ save: true }` 触发持久化

### 5.3 与 storage 的集成

```ts
const channel = createAgentChannel({
  persist: async (event, opts) => {
    if (opts?.save)
      await storage.append(entry('event', event))
  }
})
```

所有带 `save: true` 的 emit 都会被自动持久化为 `AgentEntry<'event'>`。

## 6. Plugin System — 插件生命周期

### 6.1 接口

```ts
interface AgentPlugin {
  name: string
  enforce?: 'pre' | 'post'
  version?: string

  init?: (agent: Agent) => MaybePromise<void>
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  transformEntries?: (entries: readonly AgentEntry[], options: TransformEntriesOptions) => MaybePromise<readonly AgentEntry[]>
  prepareStep?: PrepareStep
  preToolCall?: PreToolCall
  postToolCall?: PostToolCall
  onTurnFinish?: (options: TurnFinishOptions) => MaybePromise<void>
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  stop?: () => MaybePromise<void>
}
```

### 6.2 生命周期顺序

```
plugin.init(agent)
  │
  ▼
  ┌─ extendInstructions() → 拼接到系统提示之后
  ├─ extendTools()         → 追加工具列表
  ├─ transformEntries()    → 转换历史条目（如压缩）
  └─ prepareStep()         → 每一步开始前的钩子

  ▼  (Runner 每次 LLM 调用)
  ┌─ preToolCall()   → 工具调用前
  ├─ postToolCall()  → 工具调用后
  └─ onStepFinish()  → 每一步完成

  ▼  (Turn 级别)
  ┌─ onTurnFinish()  → Turn 完成
  └─ onFinish()      → Runner 完成

  plugin.stop()
```

### 6.3 Hook 链

多个插件的同类型 hook 组合为链：

| Hook | 组合方式 | 说明 |
|------|---------|------|
| `extendInstructions` | 串联 | 结果用 `\n\n` 拼接 |
| `extendTools` | 串联 | 结果压平到一个数组 |
| `transformEntries` | 串联 | 每个插件转换后的结果传给下一个 |
| `prepareStep` | 合并 | 顺序执行，结果 merge（后面的覆盖前面的） |
| `onFinish` / `onStepFinish` | `every` | 全部执行，不短路 |
| `postToolCall` / `preToolCall` | `some` | 任一返回非 undefined 则短路 |

### 6.4 enforce 排序

```ts
enforce: 'pre'   → order = 0  (先执行)
enforce: undefined → order = 1
enforce: 'post'  → order = 2  (后执行)
```

这对 `transformEntries` 尤其重要——压缩插件应该在整理插件之前执行。

### 6.5 插件规范化

```ts
normalizePlugins(options: AgentPluginOption[]): AgentPlugin[]

// AgentPluginOption = AgentPlugin | AgentPluginOption[] | false | null | undefined
```

支持嵌套数组和 falsy 快捷禁用（`plugins: [prod ? compact() : false]`）。

## 7. StateManager — 不可变状态

### 7.1 接口

```ts
interface AgentStateManager {
  get: () => Readonly<AgentState>
  set: (next: AgentState | ((prev) => AgentState)) => void
  update: (next: Partial<AgentState>) => void
  restore: (next: AgentState) => void  // 静默恢复，不触发 onChange
}
```

### 7.2 核心约束

- **不可变**：所有 mutation 通过 `structuredClone()` 创建新对象
- **自动持久化**：每次 `set()` / `update()` 自动写入 storage（通过 `onChange` 回调）
- **静默恢复**：`restore()` 用于 `init()` 时从 storage 恢复，不重复写入

### 7.3 AgentState

```ts
type AgentState = AgentCustomState & {
  agentName?: string
  agentDescription?: string
  userName?: string
  userDescription?: string
  contextLength?: number
}
```

`AgentCustomState` 是一个空 interface，用户可以通过 module augmentation 扩展。

## 8. AgentStorage — 存储抽象

### 8.1 接口

```ts
interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
  clear: () => MaybePromise<void>
}
```

**三个操作，没有更多**——这是刻意的约束。

### 8.2 内置实现

| 实现 | 持久化 | 用途 |
|------|--------|------|
| `mem()` | ❌ 内存 | 测试、临时 Agent |
| `none()` | ❌ 丢弃 | 只做事件流，不保留历史 |

`@apeira/storage` 包提供了文件持久化的 `json()`、`jsonl()`、`kv()`。

### 8.3 Storage 集成模式

Agent 内部通过 `mutateStorage()` 包装确保顺序写入：

```ts
const mutateStorage = async (operation) => {
  const result = storageReady.then(operation, operation)
  storageReady = result.catch(() => {})
  return result
}
```

这是一种**链式 Promise 串行化**——每个 storage 操作等到前一个完成，错误不阻塞后续写入。

## 9. Runner 抽象

### 9.1 接口

```ts
type Runner = (context: RunnerContext) => Promise<RunnerResult>

interface RunnerContext {
  abortSignal?: AbortSignal
  channel: AgentChannel
  input: readonly AgentInput[]
  instructions: string
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep
  preToolCall?: PreToolCall
  tools: Tool[]
  turnId: string
}

interface RunnerResult {
  output: AgentInput[]
  usage?: Usage
}
```

### 9.2 chat() — Chat Completions Runner

```ts
import { chat } from '@apeira/core/chat'

const agent = createAgent({
  runner: chat({ model: 'gpt-4o' }),
})
```

核心逻辑：

```
chat(options) → Runner
  │
  ├── 将 AgentInput[] 转换为 Message[] (toChat)
  │   ├── message → role + content
  │   ├── function_call → assistant + tool_calls
  │   └── function_call_output → tool role
  │
  ├── 将 instructions 注入为 system message
  ├── 调用 streamText() (xsai)
  ├── 事件通过 channel.emit('apeira', ...) 转发
  │
  └── 将返回的 Message[] 转回 AgentInput[] (fromChat)
```

**stopWhen**：默认 `stepCountAtLeast(20)`，即最多 20 步。

### 9.3 responses() — Responses API Runner

```ts
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  runner: responses({ model: 'gpt-4o' }),
})
```

结构与 chat runner 类似，但使用 `@xsai-ext/responses` 作为底层。`toResponses()` 将 assistant message 中的 `tool_calls` 展开为独立的 `function_call` item（Responses API 的特殊格式）。

### 9.4 Runner 与 Plugin 的关系

Runner 不感知 plugin，只接收已解析的参数：

```
Plugin pipeline → Runner
  extendInstructions → instructions
  extendTools → tools
  transformEntries → historical entries → toAgentInput → input
  prepareStep → prepareStep
  preToolCall → preToolCall
  postToolCall → postToolCall
```

Runner 只需要把 hook 透传给底层 LLM 调用。

## 10. AgentEntry — 存储单元

### 10.1 模型

```ts
type AgentEntry<T extends keyof AgentCustomEntry> = {
  data: AgentCustomEntry[T]
  id: string
  parentId?: string
  timestamp: number
  type: T  // 'event' | 'input' | 'state'
}
```

三个 entry 类型对应三种持久化数据：

| type | data 内容 | 何时写入 |
|------|----------|---------|
| `input` | `AgentInput` | 输入发送 + 输出产生 |
| `state` | `AgentState` | `state.set()` / `state.update()` |
| `event` | `AgentEvent` | 带 `save: true` 的 `channel.emit()` |

### 10.2 工具函数

```ts
// 创建 entry
entry('input', user('hello'))  → AgentEntry<'input'>

// 从 entries 提取输入历史
toAgentInput(entries)          → AgentInput[]
```

## 11. Fork — 分支 Agent

```ts
const child = await fork(parent, {
  inheritEntries: true,     // 复制父的存储历史
  instructions: '...',      // 可覆盖
  storage: json({ ... }),   // 新存储（必需）
  init: true,               // 自动调用 init()
})
```

**核心约束**：fork 时必须提供新 storage（`# inheritEntries: true` + `# storage === parent.storage` 会抛出错误），以防止子 Agent 污染父的存储。

## 12. run() — 转换为 ReadableStream

```ts
const stream = run(agent, user('Hello'))

for await (const event of stream) {
  // AgentEvent: turn.start, turn.done, ...
}
```

`run()` 将 Agent 的 `send()` + `subscribe()` 包装为 `ReadableStream<AgentEvent>`，方便在 Web Streams 环境中集成（如 HTTP streaming response）。

## 13. 完整数据流

```
用户调用 agent.send(user('Hello'))
  │
  ▼
AgentQueue.send()
  ├── 如果没有活跃 Turn → enqueue 新 Turn + pump()
  │
  ▼
pump() → runTurn()
  │
  ├── channel.emit('apeira', { type: 'turn.queued' })
  ├── 调用 plugin.init() (如果未初始化)
  ├── channel.emit('apeira', { type: 'turn.start' })
  │
  ▼
  │  while (!aborted) {
  │    runner({
  │      input,           ← 当前的 AgentInput[]（含历史 + 新输入）
  │      instructions,     ← 基础 + 所有 extendInstructions
  │      tools,            ← 所有 extendTools
  │      prepareStep,      ← 所有 prepareStep 合并
  │      preToolCall,      ← 所有 preToolCall 链
  │      postToolCall,     ← 所有 postToolCall 链
  │      ...
  │    })
  │
  │    → Runner 返回 { output, usage }
  │
  │    if (pendingInput.length > 0) {
  │      emit('turn.input_drained')
  │      input = pendingInput.splice(0)  ← 消费实时注入
  │      continue                         ← 继续循环
  │    }
  │    break
  │  }
  │
  ▼
  ├── 持久化 input entries + output entries
  ├── channel.emit('apeira', { type: 'turn.done' })
  └── 调用 plugin.onTurnFinish()
```

## 14. 设计原则

1. **队列即编排** — Queue 不仅发消息，更是整个 Turn 生命周期的编排器
2. **插件不感知 Runner** — Plugin 通过 hook 修改 Runner 的参数，但不直接调用 Runner
3. **状态不可变** — `structuredClone` 保证引用隔离
4. **存储仅追加** — storage 只 append，不 update，支持事件溯源
5. **延迟初始化** — `createAgent` 不触发 I/O，`init()` 才恢复状态
6. **错误不阻塞队列** — 单个 Turn 失败不影响后续 Turn，单个 plugin hook 失败不影响其他 hook
7. **Runner 可替换** — chat / responses / 自定义 Runner 共享同一套 Agent 模型
8. **最小外部依赖** — 仅依赖 `yocto-queue` 和 `@xsai-*` 系列

## 15. 扩展点

| 扩展方向 | 涉及的接口 |
|----------|-----------|
| 新 LLM API | 实现 `Runner` |
| 新存储后端 | 实现 `AgentStorage` |
| 新功能插件 | 实现 `AgentPlugin` |
| 自定义状态字段 | 扩展 `AgentCustomState` |
