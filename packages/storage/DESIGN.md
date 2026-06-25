# @apeira/storage — Persistent Storage Adapters

## 1. 定位

`@apeira/storage` 为 Apeira Agent 提供 **可插拔的持久化存储后端**。它实现了 `@apeira/core` 定义的 `AgentStorage<T>` 接口，提供三种内置存储策略，覆盖不同的使用场景。

```
AgentStorage<T>
  ├── json()   → 单个 JSON 数组文件
  ├── jsonl()  → 新行分隔的 JSON 文件 (append-friendly)
  └── kv()     → Key-Value 分段存储 (浏览器/边缘)
```

### 核心价值

| 能力 | 解决的问题 |
|------|-----------|
| 多后端 | 一份 Agent 代码，适配本地文件、浏览器、边缘环境 |
| Append-only | 仅追加不修改，保证事件溯源完整性 |
| 并发安全 | 键粒度串行队列，消除写冲突 |
| 原子写入 | JSON/JSONL 的 fsync-safe，KV 的事务性分段 |
| 读取缓存 | 内存缓存 + freeze 返回，减少 I/O |

---

## 2. AgentStorage 接口

由 `@apeira/core` 定义的契约，所有存储后端必须实现：

```ts
interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => Promise<void>
  read:   () => Promise<readonly T[]>
  clear:  () => Promise<void>
}
```

设计约束：
- **只追加，不修改**：已写入的 item 不可变
- **read 返回只读引用**：调用方不应修改返回值
- **无初始数据注入**：存储是纯容器，初始数据由 Agent 管理

---

## 3. 公共基础设施

### 3.1 Keyed Queue —— 键粒度串行化

```ts
const createKeyedQueue = <K>() => {
  const ops = new Map<K, Promise<void>>()

  return async <T>(key: K, fn: () => Promise<T>): Promise<T> => {
    const prev = ops.get(key) ?? Promise.resolve()
    const result = prev.then(fn, fn)
    ops.set(key, result.then(() => {}, () => {}))
    return result
  }
}
```

**设计要点**：
- 按 key（文件路径或 prefix）隔离：不同文件的读写独立并行
- 同一 key 的操作严格串行：第二个 append 必须等第一个完成
- 错误不阻塞队列：前一个操作失败，下一个仍会执行（通过 `(prev).then(fn, fn)`）
- 使用 [WeakMap](#) 的变体（实际使用 Map）防止内存泄漏

### 3.2 原子文件写入

```ts
const writeFileAtomic = async (path, content) => {
  const tmp = `${dirname(path)}/.tmp-${rand}-${now}`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, path)  // POSIX rename 是原子的
}
```

- 先写临时文件，再 rename——防止写入中途崩溃导致文件损坏
- 失败时清理临时文件

### 3.3 安全读取

```ts
const readFileSafe = async (path) => {
  try {
    return await readFile(path, 'utf-8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined  // 文件不存在 = 空存储
    throw error
  }
}
```

- `ENOENT` 视为正常（空存储），其他 I/O 错误向上抛出

---

## 4. 三种存储后端

### 4.1 JSON 存储

**格式**：单个 JSON 数组文件，pretty-printed

```
文件内容:
[
  {"id":"a1","type":"input","data":{...}},
  {"id":"b2","type":"state","data":{...}},
  {"id":"c3","type":"input","data":{...}}
]
```

**实现关键**：

```
append(items):
  1. 从磁盘加载全部 → 解码为数组
  2. 追加新 item 到数组末尾
  3. 编码为 JSON 写回磁盘（全量重写）

read():
  1. 首次读取：加载 + 解码 + 缓存
  2. 后续读取：直接返回缓存（不读磁盘）
  3. append 后自动更新缓存
```

**特性**：
- 人类可读（pretty-printed）
- 适合调试和小型数据集
- 不适合高频写入——每次 append 重写整个文件
- 缓存策略：读后缓存，append 后刷新

### 4.2 JSONL 存储

**格式**：新行分隔的 JSON，每行一个 item

```
文件内容:
{"id":"a1","type":"input","data":{...}}
{"id":"b2","type":"state","data":{...}}
{"id":"c3","type":"input","data":{...}}
```

**实现关键**：

```
append(items):
  1. 加载磁盘内容到内存（首次）
  2. 如果文件已有内容 → 使用 appendEncode 直接追到文件末尾
     而非全量重写
  3. 如果文件为空或不存在 → 全量写
  4. 更新内存缓存

appendEncode(items) = items.map(JSON.stringify).join('\n') + '\n'
```

**核心优化——append without rewrite**：

```
文件已有 [a, b]：
  → 磁盘追加 "\n" + JSON.stringify(c)
  → 不重写已有内容

文件为空：
  → 全量写入 encode(all)
  → 确保格式正确
```

**特性**：
- 追加效率高——不重写已有数据
- 流式处理友好——可以逐行解析
- 适合高频写入场景（agent turn 的实时持久化）
- 每行独立解析，损坏只影响单行（JSON 需要完整的数组）

### 4.3 KV 分段存储

**格式**：Key-Value store 中的分段数组

```
keys (prefix = "apeira"):
  apeira:head        → "3"          // 当前段号
  apeira:seg:0000001 → "[1,2]"      // 段1: 最多 segmentSize 个 item
  apeira:seg:0000002 → "[3,4]"      // 段2
  apeira:seg:0000003 → "[5]"        // 段3 (可能不满)
```

**实现关键**：

```
初始化:
  getHead() → 读取 apeira:head
  如果不存在 → writeItems([]), setHead(0)

append(items):
  1. 读取 head → 确定当前活跃段
  2. 读取当前段内容
  3. 如果当前段已满 (≥ segmentSize)：
     - 写回当前段 → 创建新段
  4. 追加 item 到当前段
  5. 写回活跃段 + 更新 head

read():
  并行读取所有段 (seg:0000001 .. seg:head)
  → flat 合并 → freeze 返回
```

**分段策略示意** (segmentSize = 100):

```
append(1-150):
  段1: [1..100]   ✓ 满
  段2: [101..150] ✓ head=2

append(151-250):
  段2: [101..150, 151..200]   ← 追加到未满段
  段3: [201..250]              head=3
```

**并发模型**：

```ts
// 同一后端实例的所有 kv() 实例共享一个 queue
const queues = new WeakMap<StorageLike, Enqueue>()

// 按 prefix 隔离——不同 prefix 可以并行
queueOf(backend)(prefix, async () => { ... })
```

**特性**：
- 适合 Key-Value 后端（localStorage、IndexedDB、Redis 等）
- 分段避免单个 key 的值过大
- 可配置 segmentSize（默认 100）
- 不同 prefix 可以共存于同一个 KV store
- 按 prefix + backend 双重隔离并发

---

## 5. FileStorage 抽象层

`createFileStorage()` 是 JSON 和 JSONL 的共享基础：

```
createFileStorage(options, codec) → AgentStorage
  │
  ├── 管理内存缓存 (items[])
  ├── 延迟初始化 (首次操作时才读磁盘)
  ├── 序列化控制 (keyed queue by path)
  └── 编解码委托给 codec
```

**编解码器契约**：

```ts
interface FileStorageCodec<T> {
  encode:        (items: readonly T[]) => string   // 全量编码
  decode:        (raw: string)          => T[]      // 全量解码
  appendEncode?: (items: readonly T[]) => string   // 增量编码（可选）
}
```

| Codec | encode | appendEncode | decode |
|-------|--------|-------------|--------|
| JSON  | `JSON.stringify(items, null, 2) + '\n'` | ❌ 无 | `JSON.parse(raw)` → 校验数组 |
| JSONL | `items.map(JSON.stringify).join('\n') + '\n'` | ✓ 同上 | 逐行 `JSON.parse` |

---

## 6. 并发安全机制

### 6.1 三层隔离

```
Layer 1: Keyed Queue
  同一文件/key 的操作串行 → append 不交错

Layer 2: 写-读一致性
  append 后立即更新缓存 → read 总是返回最新

Layer 3: 原子写入
  writeFileAtomic (临时文件 + rename) → 不会读到半写文件
```

### 6.2 读缓存策略

```
首次 read()  → 读磁盘/decode → 缓存
后续 read()  → 直接返回缓存 (零 I/O)
append()     → 更新缓存 (新值)
clear()      → 清空缓存 ([])
```

**缓存边界**：仅缓存当前进程内的最新状态。外部修改文件不被感知——这是刻意的设计，因为 Apeira 假定单进程独占写入。

---

## 7. 容错与错误处理

| 场景 | JSON | JSONL | KV |
|------|------|-------|-----|
| 文件不存在 | `read()` → `[]` | 同 | 同 |
| 文件为空 | `[]` | `[]` | 初始化 head=0 |
| 格式损坏 | `SyntaxError` / `Invalid storage file` | `Invalid JSON at line N` | `decode` → `[]` (静默降级) |
| 并发写入 | keyed queue 串行化 | 同 | 同（按 prefix+backend） |
| 写入崩溃 | 原子 rename 防止损坏 | 同 | 分段独立，已写入段安全 |

**KV 的静默降级**：损坏的段返回空数组而非抛错，因为：
1. 前端 storage 更容易出现数据损坏
2. 丢失一段比完全不可用更好
3. 日志中会体现为历史缺失，不影响新写入

---

## 8. 与 @apeira/core 的集成

### 8.1 使用方式

```ts
import { createAgent } from '@apeira/core'
import { json } from '@apeira/storage/json'

const agent = createAgent({
  instructions: '...',
  runner: responses({ ... }),
  storage: json({ path: './agent-data.json' }),
})
```

### 8.2 mem() 作为无持久化基线

```ts
// @apeira/core 内置
export const mem = <T = AgentEntry>(): AgentStorage<T> => {
  const items: T[] = []
  return {
    append: async (...args) => { items.push(...args) },
    read:   async () => Object.freeze([...items]),
    clear:  async () => { items.length = 0 },
  }
}
```

`mem()` 是纯内存实现，API 与所有存储后端完全一致，方便测试和开发。

---

## 9. 存储后端选择指南

| 场景 | 推荐 | 原因 |
|------|------|------|
| 本地开发 / CLI | JSON | 人类可读，便于调试 |
| 生产服务端 | JSONL | 追加高效，不重写全量 |
| 浏览器 / React Native | KV | localStorage/IndexedDB 友好 |
| 测试 | mem() | 零配置，纯内存 |
| 高频 Agent 交互 | JSONL | O(1) append，流式友好 |
| 需要分支管理 | Session | 使用 Session.storage 包装上述任意后端 |

---

## 10. 架构图

```
┌─────────────────────────────────────────────────────────┐
│                  @apeira/core                            │
│             AgentStorage<T> interface                    │
│       append() · read() · clear()                       │
└──────────────────────┬──────────────────────────────────┘
                       │  implements
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   JSON      │ │   JSONL     │ │    KV       │
│  json.ts    │ │  jsonl.ts   │ │   kv.ts     │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │               │
       ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│             createFileStorage()                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ KeyedQueue │  │   Cache    │  │     Codec          │ │
│  │ (by path)  │  │  (items[]) │  │ encode / decode    │ │
│  └────────────┘  └────────────┘  │ appendEncode       │ │
│                                   └────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│  Node.js fs API │         │  StorageLike    │
│  readFile       │         │  getItem        │
│  writeFile      │         │  setItem        │
│  rename         │         │  removeItem     │
│  appendFile     │         │                 │
└─────────────────┘         └─────────────────┘
    File System               KV Store (localStorage,
                              IndexedDB, Cloudflare KV,
                              Redis, etc.)
```

---

## 11. 数据流示意

### append 流程

```
agent.storage.append(entry1, entry2)
  │
  ▼
keyedQueue(path, async () => {   ← 获取该文件的锁
  │
  ├─[JSON]:   loadItemsFromDisk()
  │            → decode(raw) → [existing...]
  │            → [...existing, entry1, entry2]
  │            → encode(all) → writeFileAtomic(path, content)
  │
  ├─[JSONL]:  loadItemsFromDisk()
  │            → [...existing, entry1, entry2]
  │            → hasContent?
  │              YES → appendFile(path, appendEncode([entry1, entry2]))
  │              NO  → writeFileAtomic(path, encode(all))
  │
  └─[KV]:     getHead()
               → 当前段不满? → 追加到该段
               → 当前段满?   → 写回该段, 创建新段, 追加
               → setHead(newHead)
})
  │
  ▼
更新内存缓存 → ready
```

### read 流程

```
agent.storage.read()
  │
  ▼
keyedQueue(path, async () => {
  │
  ├─[首次]: loadItemsFromDisk() → decode → 缓存 → return freeze
  └─[后续]: return 缓存 (零 I/O)
})
```

---

## 12. 设计原则

1. **接口统一** — 所有后端实现同一个 `AgentStorage<T>` 接口，Agent 无需感知后端差异
2. **Append-Only** — 只追加不修改，保留完整的事件溯源链。clear 是唯一的"写零"操作
3. **并发安全** — Keyed queue 保证同 key 操作串行，不同 key 并行
4. **原子写入** — 使用临时文件 + rename 保证文件完整性
5. **延迟初始化** — read 不创建文件（ENOENT 返回空），append 才创建
6. **缓存透明** — 读缓存对调用方透明，减少 I/O 但保持语义一致
7. **最小依赖** — 仅依赖 `@apeira/core` (types) 和 Node.js 标准库
