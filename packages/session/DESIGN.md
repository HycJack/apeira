# @apeira/session — Tree-shaped Durable Sessions

## 1. 定位

`@apeira/session` 为 Apeira Agent 提供 **Git 式分支会话管理**。每一个 Agent 交互被建模为 append-only event sourcing 日志，支持 checkout、fork、rebase、clone 等操作，使 Agent 对话可以像代码仓库一样进行分支、合并和回溯。

### 核心价值

| 能力 | 解决的问题 |
|------|-----------|
| 分支 (fork) | 从任意历史点派生独立的 Agent 上下文 |
| 切换 (checkout) | 在多个对话分支间自由穿梭 |
| 变基 (rebase) | 调整分支的基点到新的历史位置 |
| 克隆 (clone) | 复制会话到独立存储，隔离实验 |
| 事件溯源 | 完整可审计的对话历史，支持 replay |

---

## 2. 存储模型

### 2.1 Append-only Event Sourcing

Session 底层是一个 **只能追加 (append-only)** 的 entry 日志。所有操作——包括输入、状态变更、分支控制——都以 `AgentEntry` 的形式追加到同一个 `AgentStorage` 实例中。

```
原始日志 (flat):
┌──────────────────────────────────────────────────────┐
│ [0] session/ref    { name: "main" }                   │
│ [1] session/checkout { target: { type: "ref", main }} │
│ [2] input          user("hello")                      │
│ [3] state          { agentName: "test" }              │
│ [4] input          assistant("hi")                    │
│ [5] session/checkout { target: { type: "empty" }}     │
└──────────────────────────────────────────────────────┘
```

### 2.2 Parent-linked DAG

每个 entry 通过 `parentId` 指向其父 entry，形成一棵有向无环图 (DAG)：

```
                    session/ref(main)
                          │
                    session/checkout → main
                          │
                       input: user("hello")
                          │
                       state: { agentName: "test" }
                        /        \
          input: user("main")   input: user("feature")
          (checkout main)       (fork → feature)
```

- 只有 **语义节点**（`input`、`state`、`compact`、自定义 entry）会被链接为 parent 链
- **事件节点** (`event`) 挂载在最近的语义节点下，不参与 parent 链
- **控制节点** (`session/ref`、`session/checkout`) 修正 HEAD 和 ref 指向，自身不注入 parent 链

### 2.3 Entry 类型

| 类型 | 命名空间 | 语义 | parent 链 |
|------|---------|------|-----------|
| `input` | core | 用户/助手消息 | ✓ |
| `state` | core | Agent 状态快照 | ✓ |
| `compact` | plugin | 对话压缩摘要 | ✓ |
| 自定义 | 用户扩展 | 任意语义节点 | ✓ |
| `event` | core | 生命周期事件 | ✗ (挂在父 entry) |
| `session/ref` | session | ref 定义 | ✗ |
| `session/checkout` | session | HEAD 移动 | ✗ |

---

## 3. 核心数据结构

### 3.1 SessionSnapshot（replay 结果）

```ts
interface SessionSnapshot {
  entries: readonly AgentEntry[]           // 原始日志
  entryById: ReadonlyMap<EntryId, AgentEntry> // O(1) 查找
  head: Head                                // 当前 HEAD
  headTargetId?: EntryId                    // HEAD 解析后的目标 entry ID
  refs: ReadonlyMap<RefName, EntryId | undefined> // 所有 ref 及其指向
}
```

通过 `replay()` 函数对原始日志重放得出，是整个系统的基础快照。

### 3.2 Head 的三种形态

```ts
type Head
  = { name: RefName, type: 'ref' }       // 指向一个 ref（如 "main"）
  | { targetId?: EntryId, type: 'detached' } // detached HEAD（直接指向 entry 或空）
```

- **ref 模式**: HEAD 跟踪 ref，ref 更新时 HEAD 自动跟随
- **detached 模式**: HEAD 指向具体 entry ID（类似 `git checkout <commit>`）
- **empty 模式**: detached HEAD 且 targetId 为 undefined（类似 `git checkout --orphan`）

### 3.3 Ref 系统

Ref 是命名指针，指向某个 entry。核心操作：

- **创建/更新**: 每个 turn 完成后自动更新 ref → 指向最新的语义节点
- **fork**: 创建新 ref，指向当前位置
- **rebase**: 改变 ref 的基础提交

### 3.4 变更串行化

```ts
const createMutationQueue = () => {
  let ready = Promise.resolve()
  return async <T>(op: () => Promise<T>): Promise<T> => {
    const result = ready.then(op, op)
    ready = result.then(() => undefined, () => undefined)
    return result
  }
}
```

所有 session 操作通过 mutation queue 严格串行化，保证：
- 同一时刻只有一个写操作在执行
- 操作按调用顺序执行
- 前一个操作失败不影响后续操作执行

---

## 4. 核心操作

### 4.1 replay —— 日志重放

`replay(entries)` 是纯函数，不依赖外部状态。通过遍历原始日志构建 `SessionSnapshot`：

```
遍历 → 遇到 session/ref → 更新 refs Map
      → 遇到 session/checkout → 更新 head
      → 最终产出 head + headTargetId + refs
```

### 4.2 semanticPath —— 语义路径

从给定 entry 沿 parent 链回溯到根，返回逆序数组（根→目标）：

```
entry-4 (parent: entry-3)
entry-3 (parent: entry-2)
entry-2 (parent: entry-1)
entry-1 (parent: undefined)

→ semanticPath(entry-4) = [entry-1, entry-2, entry-3, entry-4]
```

用于构建任意点的完整对话上下文。

### 4.3 branchPath —— 分支路径

`sematicPath` + 附属事件：

```ts
const branchPath = (snapshot, targetId) => {
  const semantic = semanticPath(snapshot, targetId)
  const semanticIds = new Set(semantic.map(e => e.id))

  return snapshot.entries.filter(entry =>
    semanticIds.has(entry.id)                          // 语义节点
    || (entry.type === 'event'                         // 附属事件
        && entry.parentId != null
        && semanticIds.has(entry.parentId))
  )
}
```

`branchPath` 返回的分支路径即 `Session.storage` 对外暴露的内容——Agent 通过 `session.storage.read()` 看到的正是当前分支的完整视图。

### 4.4 checkout —— 分支切换

```ts
checkout(target?) {
  1. 读取当前快照
  2. 断言 idle（没有活跃的 turn）
  3. 追加 session/checkout entry
  4. 通知所有观察者（plugin 同步 state）
}
```

- `checkout("main")` → HEAD → ref mode
- `checkout("<entry-id>")` → HEAD → detached mode
- `checkout()` / `checkout(undefined)` → HEAD → empty mode

### 4.5 fork —— 分支创建

```ts
fork(name, { from?, checkout=true }) {
  1. 验证 ref 名称合法性
  2. 读取快照 + 断言 idle
  3. 解析 from → 目标 entry ID
  4. 追加 session/ref entry
  5. 若 checkout=true：追加 session/checkout entry + 通知
}
```

### 4.6 rebase —— 分支变基

```
Before rebase feature onto main:
    main:    root → main-one
    feature: root → feature-one → feature-two

After:
    main:    root → main-one
    feature: root → main-one → feature-one' → feature-two'
             (feature 的独有提交被复制到 main 之上)
```

实现流程：
```
1. 读取快照 + 断言 idle
2. 解析 oldHeadId (feature ref 指向) 和 newBaseId (onto 指向)
3. 计算 source = semanticPath(oldHeadId)
4. 计算 target = semanticPath(newBaseId)
5. 找到最近公共祖先 (LCA)
6. 复制 LCA 之后的 source 独有 entry，new parent = newBaseId
7. 追加复制后的 entry + 更新 ref
8. 如果 active HEAD 是该 ref，通知 plugin 同步 state
```

### 4.7 clone —— 会话克隆

```ts
clone({ sessionStorage, from?, refs?, checkout? }) {
  1. 读取快照 + 断言 idle
  2. 确定需要复制的 refs 集合
  3. 收集所有语义路径上的 entry + 附属事件
  4. 复制到新的 sessionStorage
  5. 在新存储上创建 Session 实例
  6. 执行 checkout
  7. 返回新的 Session 实例
}
```

### 4.8 Session.storage —— Agent 透明集成的关键

```ts
const storage: AgentStorage<AgentEntry> = {
  append: async (...entries) => mutate(async () => {
    // 将 entries parent 链接到当前 HEAD 位置
    // 追加后更新 ref/checkout
  }),
  read: async () => path(),    // 返回当前分支完整视图
  clear: async () => mutate(...) // 清空当前分支
}
```

`Session.storage` 是一个 **视图代理**——它基于语义路径和当前 HEAD，将原始的 flat 日志转换为当前分支的有序视图。Agent 使用 `session.storage` 作为存储后端时，自动获得了分支隔离能力，无需修改任何 Agent 代码。

---

## 5. Plugin 集成

### 5.1 session.plugin

Session 暴露一个 `plugin` 属性，返回 `AgentPlugin` 实例：

```ts
const plugin: AgentPlugin = {
  name: 'apeira.session',
  init(agent) {
    // 注册 branch change handler
    handler = async (payload) => {
      agent.state.restore(payload.state)
      await agent.emit(`session.${payload.type}`, payload, { save: false })
    }
    branchChangeHandlers.add(handler)
  },
  stop() { ... }
}
```

当 checkout/fork/rebase 触发 branch change 时：
1. Agent 的 state 被同步到目标分支的最新状态
2. 事件被 emit 到 agent channel（不持久化，因为控制 entry 已经记录了变更）

### 5.2 使用方式

```ts
const session = createSession({
  defaultRef: 'main',
  sessionStorage: mem(),
})

const agent = createAgent({
  instructions: '...',
  runner: responses({ ... }),
  plugins: [session.plugin],
  storage: session.storage,  // 使用 session 的 storage 视图
})
```

---

## 6. 安全性约束

### 6.1 Ref 名称校验

`validateRef(name)` 拒绝与 Git 类似的非法 ref 名：

- 空字符串、`@`、`HEAD`
- 以 `.` 开头或结尾
- 以 `/` 或 `.lock` 结尾
- 包含 `..`、`//`、`/.`、`@{`
- 包含控制字符或 ` ~^:?*[\`

### 6.2 Idle 检查

`assertIdle()` 确保在有活跃 turn（`turn.start` 到 `turn.done/failed/aborted` 之间）时不能执行分支操作：

```ts
const assertIdle = (entries) => {
  const active = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    if (event.type === 'turn.start') active.add(event.turnId)
    else if (['turn.done', 'turn.failed', 'turn.aborted'].includes(event.type))
      active.delete(event.turnId)
  }
  if (active.size > 0)
    throw new SessionError('busy', ...)
}
```

同时具有防御性——对格式不正确的 event data 不会崩溃，只是跳过。

### 6.3 并发安全

通过 mutation queue 保证所有写操作严格串行。测试验证了并发 append 不会出现交错。

---

## 7. 架构图

```
┌─────────────────────────────────────────────────┐
│                   Session                        │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ checkout │  │   fork   │  │    rebase     │ │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘ │
│       │              │                │          │
│       ▼              ▼                ▼          │
│  ┌──────────────────────────────────────────┐   │
│  │          Mutation Queue                   │   │
│  │    (strict serialization of writes)       │   │
│  └────────────────┬─────────────────────────┘   │
│                   │                              │
│                   ▼                              │
│  ┌──────────────────────────────────────────┐   │
│  │           Event Sourcing                  │   │
│  │  append() ─► AgentStorage (raw log)       │   │
│  └────────────────┬─────────────────────────┘   │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐   │
│  │              Replay                        │   │
│  │  raw log ─► SessionSnapshot                │   │
│  │            (head, refs, entryById)         │   │
│  └────────────────┬──────────────────────────┘   │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐   │
│  │         Semantic Path / Branch Path        │   │
│  │  snapshot ─► ordered branch view           │   │
│  └────────────────┬──────────────────────────┘   │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐   │
│  │          Session.storage (view)            │   │
│  │  对外暴露为 AgentStorage，Agent 直接使用    │   │
│  └────────────────┬──────────────────────────┘   │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐   │
│  │          Session.plugin (sync)             │   │
│  │  checkout/fork/rebase → sync state + emit  │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 8. 数据流示意

```
用户操作
  │
  ▼
session.storage.append(input)          Agent 写入
  │
  ▼
mutate() → mutation queue              串行化
  │
  ▼
获取当前 snapshot + headTargetId      确定 parent
  │
  ▼
构建 parent 链:                        链接到 HEAD
  input.parentId = currentHeadTargetId
  │
  ▼
追加到 sessionStorage (raw log)        持久化
  │
  ▼
追加 session/ref (更新指针)            如果 tail 变化
  │
  ▼
agent.subscribe() → 感知变化           Agent 消费
```

```
checkout / fork / rebase
  │
  ▼
mutate()
  │
  ▼
追加 control entries (session/ref or session/checkout)
  │
  ▼
replay → 获取新 snapshot
  │
  ▼
notifyBranchChange()
  │
  ├──► session.plugin handler:
  │      agent.state.restore(payload.state)
  │      agent.emit('session.checkout', payload)
  │
  └──► session.storage.read() 返回新分支视图
```

---

## 9. 与 @apeira/core 的边界

| 职责 | Core | Session |
|------|------|---------|
| Agent 生命周期 | ✓ | |
| Turn 执行 / Queue | ✓ | |
| State 管理 | ✓ | |
| 原始 Storage 接口 | ✓ (定义) | |
| Event Channel | ✓ | |
| 分支 / 切换 / 变基 | | ✓ |
| 语义路径追溯 | | ✓ |
| HEAD / ref 管理 | | ✓ |
| Session 级别的 storage 视图 | | ✓ |
| 状态同步 (branch change) | | ✓ |

Session 不修改 core 的任何行为。它通过实现 `AgentStorage` 接口和提供 `AgentPlugin` 来增强 Agent，保持与 core 的松耦合。

---

## 10. 与 Git 的对比

| 概念 | Git | @apeira/session |
|------|-----|-----------------|
| 存储单元 | commit (tree/blob) | AgentEntry |
| 分支 | branch → commit | ref → entry ID |
| HEAD | ref 或 detached | Head (ref / detached) |
| checkout | 切换分支/提交 | checkout(target) |
| fork | branch | fork(name) |
| rebase | 重写提交历史 | 复制语义条目到新基点 |
| clone | 完整克隆仓库 | 复制选中 ref 到新存储 |
| log | 提交日志 | 原始 entry 日志 |
| working tree | 文件系统 | AgentState + AgentInput |

关键差异：
- Git 的 commit 是不可变的；Session 的 entry 追加后也不变——都遵循 append-only
- Git 的 rebase 会重写 commit hash；Session 的 rebase 是复制语义节点（原始数据保留在日志中）
- Git 分支是轻量指针；Session 的 ref 同样是轻量指针，不复制数据

---

## 11. 设计原则

1. **不可变性** — 已写入的 entry 永不修改，只追加
2. **视图而非拷贝** — `storage.read()` 返回计算出的视图，不是独立副本
3. **序列化保证** — 所有变更通过 mutation queue，消除竞态
4. **防御性** — idle 检查、ref 验证、格式容错
5. **透明集成** — Agent 使用 session.storage 不加任何特殊处理
6. **可组合** — 通过 plugin 机制与 core 集成，保持模块边界清晰
