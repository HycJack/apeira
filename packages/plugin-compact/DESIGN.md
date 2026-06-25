# @apeira/plugin-compact — Automatic Context Compaction

## 1. 定位

`@apeira/plugin-compact` 是 Apeira 的**上下文自动压缩插件**。当 LLM 上下文窗口接近耗尽时，它自动将历史对话压缩为结构化摘要，使 Agent 能够在超长对话中持续运行而不丢失关键信息。

```
长对话 → token 超阈值 → compact 触发 → 旧消息 → 摘要替换 → 释放上下文
```

**核心价值**：将 O(n) 增长的上下文代价降为 O(1)——无论对话多长，LLM 看到的上下文始终控制在阈值之内。

## 2. 触发机制

### 2.1 阈值判定

压缩在每个 Turn 结束后触发：

```
onTurnFinish(turn):
  if turn.usage.totalTokens >= contextLength * threshold:
    → 执行压缩
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `contextLength` | 128,000 | 模型的上下文窗口大小（通过 state 动态获取） |
| `threshold` | 0.9 | 触发比例，90% 时开始压缩 |

**为什么不是 100%**：在 90% 时提前压缩，为压缩过程本身的 token 消耗留出余量（压缩也需要一次 LLM 调用）。

### 2.2 动态 contextLength

```ts
const getContextLength = () => agent.state.get().contextLength ?? DEFAULT_CONTEXT_LENGTH
```

`contextLength` 不是硬编码的——它从 `AgentState` 读取，意味着模型切换时上下文大小可以动态更新。

## 3. 压缩执行流程

```
onTurnFinish 触发
  │
  ├── 1. transformCompactEntries() 模拟压缩后结果
  │      → 找到最近的 compact entry → 替换为 summary input
  │      → 去掉已被总结的旧条目
  │
  ├── 2. 计算 projectedEntries 中的 input 数量
  │      → 如果 <= preserveEntries → 跳过（已压缩到最小）
  │
  ├── 3. 确定需要摘要的条目范围 (entriesToSummarize)
  │      → preserveEntries=0: 全部可压缩
  │      → preserveEntries>0: 保留最近 N 条，压缩更早的
  │
  ├── 4. executeCompact() — 调用压缩 Agent
  │      → 创建临时 Agent，用压缩 instructions
  │      → 发送压缩触发消息，等待完成
  │      → 提取 assistant 回复作为摘要文本
  │
  └── 5. 写入 compact entry
         → entry('compact', { summary, lastEntryId })
         → 下次 transformEntries 会基于此替换历史
```

### 3.1 压缩 Agent 模型

```
临时 Agent:
  输入: 要压缩的所有历史消息 (AgentInput[])
  系统提示: DEFAULT_COMPACTION_INSTRUCTIONS
  触发消息: "Write the handoff summary now."
  输出: assistant 回复文本 → 作为 summary
```

这个临时 Agent 是一个**轻量的一次性 Agent**——独立的 storage（默认 mem），执行完即销毁。

### 3.2 压缩 instructions 的设计

```ts
const DEFAULT_COMPACTION_INSTRUCTIONS = `You are creating a handoff summary...`
```

要求 LLM 按 5 个维度总结：

1. **用户意图** — 明确的请求、目标和约束
2. **已完成事项** — 关键变更、文件路径、函数名、代码模式（精确标识符）
3. **问题与修复** — 遇到的错误及解决方式，用户改变方向的具体反馈
4. **下一步** — 继续任务的最合理动作，引用最近相关消息
5. **其他必要信息** — 关键数据、引用、决策

**设计意图**：摘要不是简单的"对话总结"，而是让下一个 LLM 能**无缝接续**任务的操作手册。

## 4. transformEntries — 条目替换引擎

### 4.1 核心逻辑

```ts
transformEntries(entries):
  找到最后一个 compact entry 的位置 (compactIndex)
  如果不存在 → 返回原样

  将该 compact entry 转为 summary input:
    data: developer(`<context_summary>\n${summary}\n</context_summary>`)

  根据 lastEntryId 确定被总结的边界:
    → 保留 lastEntryId 之后、compact 之前的条目（未被总结的新消息）
    → 移除 lastEntryId 及之前的条目（已被摘要覆盖）
    → 保留 compact 之后的条目（压缩期间产生的新消息）
```

### 4.2 视觉效果

```
压缩前 entries:
  [in1, in2, in3, ..., in100, compact{s, last=in90}, in101, in102]

transformEntries 后:
  [summary_input(s), in91, in92, ..., in100, in101, in102]
   ↑                  ↑──────────────────────↑   ↑──────────↑
   摘要替换             未被总结的新消息          压缩后新消息
```

### 4.3 lastEntryId 的作用

`lastEntryId` 标记了"哪些条目已经被上次压缩覆盖"。没有它，每次压缩都不知道该移除哪些条目。

如果 `lastEntryId` 找不到（例如条目已被外部删除），则只保留 summary + compact 之后的条目。

## 5. preserveEntries — 保留策略

```ts
compact({
  preserveEntries: 5,  // 保留最近 5 条 input，压缩更早的
})
```

| preserveEntries | 行为 |
|-----------------|------|
| 0（默认） | 所有历史条目都可以被压缩 |
| N > 0 | 保留最近 N 条 input，只压缩第 N 条之前的 |
| >= 总条目数 | 不压缩（不会触发） |

**为什么需要 preserveEntries**：最近的几条消息通常包含当前任务的关键上下文，压缩它们可能导致信息丢失。保留策略确保"热"上下文始终可用。

## 6. 容错机制

### 6.1 压缩失败计数

```ts
let compactFailures = 0

// 每次压缩成功 → 重置计数
compactFailures = 0

// 每次压缩失败 → 递增
compactFailures++

// 连续失败达到上限 → 硬截断
if (compactFailures >= MAX_COMPACT_FAILURES) {
  compactFailures = 0
  return HARD_TRUNCATION_MESSAGE  // "(Earlier conversation omitted due to length)"
}
```

### 6.2 三级降级

| 级别 | 触发条件 | 行为 |
|------|---------|------|
| 正常压缩 | 首次触发 | 调用压缩 Agent 生成摘要 |
| 静默重试 | 压缩失败 < 3 次 | 返回空字符串，跳过本次压缩 |
| 硬截断 | 连续失败 3 次 | 返回硬截断消息，强制释放上下文 |

### 6.3 空摘要保护

```ts
if (summary.length === 0)
  return  // 不写入 compact entry，下次 Turn 重新尝试
```

防止写入空摘要污染存储。

### 6.4 Refusal 检测

```ts
if (item.content.some(part => part.type === 'refusal'))
  throw new Error('Compaction summary was refused.')
```

如果压缩 Agent 的 LLM 拒绝生成摘要（安全策略），捕获并向上传播。

## 7. Compact Entry 类型扩展

```ts
declare module '@apeira/core' {
  interface AgentCustomEntry {
    compact: CompactEntry
  }
}

interface CompactEntry {
  lastEntryId?: string
  summary: string
}
```

通过 TypeScript module augmentation 向 `AgentCustomEntry` 注入 `compact` 类型，使 `entry('compact', ...)` 类型安全。

## 8. 架构图

```
┌──────────────────────────────────────────────────────────┐
│                    @apeira/core                           │
│              AgentPlugin.onTurnFinish()                   │
└──────────────────────┬───────────────────────────────────┘
                       │ 每 Turn 结束调用
                       ▼
┌──────────────────────────────────────────────────────────┐
│              @apeira/plugin-compact                       │
│                                                          │
│  onTurnFinish(turn)                                      │
│    │                                                     │
│    ├── usage.totalTokens >= contextLength * 0.9 ?        │
│    │                                                     │
│    ├── transformCompactEntries(storage) → projected      │
│    │   │                                                 │
│    │   └── 找到 compact entry → 替换为 summary            │
│    │                                                     │
│    ├── input count > preserveEntries ?                   │
│    │                                                     │
│    ├── executeCompact(historicalInput)                   │
│    │   │                                                 │
│    │   ├── createAgent(压缩指令 + 历史输入)               │
│    │   ├── run(tempAgent, trigger)                       │
│    │   └── extractAssistantSummary() → text              │
│    │                                                     │
│    └── storage.append(entry('compact', {summary,id}))    │
│                                                          │
│  transformEntries(entries)                               │
│    └── compact entry → summary input + 裁剪旧条目        │
└──────────────────────────────────────────────────────────┘
```

## 9. 数据流示意

### 正常压缩

```
Turn-50 完成 → totalTokens=120000 (128000*0.9=115200 超了)
  │
  ▼
transformCompactEntries(storage.entries)
  → 无 compact entry → 返回原样
  → projectedEntries 有 50 条 input，> preserveEntries(0)

executeCompact(前 50 条 input)
  → 临时 Agent: instructions + 历史 → "Write summary"
  → LLM 返回: "User wants to build a REST API..."
  → summary = "User wants to build a REST API..."

storage.append(entry('compact', { summary, lastEntryId: in50 }))
```

### 后续 Turn 的 transformEntries

```
Turn-51:

transformEntries(storage.entries)
  → 找到 compact{summary, lastEntryId=in50}
  → 替换为:
      [summary_input("User wants to..."),
       in51]            ← 只保留 compact 之后的新消息
  → Agent 只看到 2 条消息（而非 52 条）
```

### 连续压缩

```
Turn-100 → 又超了

transformEntries:
  → 找到 compact-1{summary-1, lastEntryId=in50}
  → 替换为 [summary_input-1, in51...in100]

executeCompact(这些):
  → 生成 summary-2（包含 summary-1 的内容 + in51...in100）

storage.append(entry('compact', { summary: summary-2, lastEntryId: in100 }))
```

## 10. 使用示例

### 基本使用

```ts
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'
import { compact } from '@apeira/plugin-compact'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: chat({ model: 'gpt-4o' }),
  plugins: [
    compact({
      compactAgent: {
        runner: chat({ model: 'gpt-4o-mini' }),  // 用便宜模型做压缩
      },
    }),
  ],
})
```

### 自定义参数

```ts
compact({
  compactAgent: {
    instructions: 'Custom compression instructions...',
    runner: chat({ model: 'gpt-4o-mini' }),
  },
  preserveEntries: 3,   // 保留最近 3 条对话
  threshold: 0.8,       // 80% 时触发
})
```

### 不指定 compactAgent.runner

```ts
compact({
  compactAgent: {},      // 使用父 Agent 的 runner
})
```

如果不提供 `compactAgent.runner`，会复用父 Agent 的 runner（同一个模型）。

## 11. getMessageText — 文本提取

```ts
export const getMessageText = (item: AgentInput): string
```

从 `AgentInput` 中提取纯文本，处理：

- 字符串 content → 直接返回
- 数组 content → 提取 `text` / `refusal` 字段 → 拼接
- 非 message 类型 → 返回空字符串
- 空数组 / 空字符串 → 返回空字符串

用于压缩 Agent 不关心不需要的辅助信息。

## 12. 设计原则

1. **后置压缩** — 在 Turn 完成后压缩，不阻塞当前交互
2. **子 Agent 模型** — 压缩使用独立的临时 Agent，不污染主 Agent 的状态和存储
3. **渐进式降级** — 三级容错（正常→静默重试→硬截断），优先保证 Agent 继续运行
4. **精确边界** — `lastEntryId` 精确标记已压缩边界，避免重复压缩或遗漏
5. **可组合** — 作为标准 `AgentPlugin` 实现，与其他插件无耦合
6. **成本感知** — 支持指定压缩用的独立模型（如用 gpt-4o-mini 压缩 gpt-4o 的对话）
7. **结构化摘要** — 5 维摘要模板确保可操作性，而非模糊总结

## 13. 常量汇总

| 常量 | 值 | 说明 |
|------|-----|------|
| `DEFAULT_CONTEXT_LENGTH` | 128,000 | 默认上下文窗口 |
| `DEFAULT_THRESHOLD` | 0.9 | 触发阈值 |
| `MAX_COMPACT_FAILURES` | 3 | 降级到硬截断的失败次数 |
| `HARD_TRUNCATION_MESSAGE` | `(Earlier conversation omitted due to length)` | 硬截断占位文本 |
