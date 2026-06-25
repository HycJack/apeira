# @apeira/plugin-common-tools — Common Development Tools

## 1. 定位

`@apeira/plugin-common-tools` 为 Apeira Agent 提供一套**通用开发工具集**——文件操作、Shell 执行、网页抓取和搜索。它是编码类 Agent 的标准装备，覆盖日常开发工作流的最常用操作。

```
read / write / edit / bash / fetch / search → Agent 可自主操作文件和网络
```

**核心理念**：让 Agent 像人类开发者一样与文件系统和外部世界交互——不需要任何特殊的沙箱或中间层。

## 2. 工具清单

| 工具 | 功能 | 关键参数 |
|------|------|---------|
| `read` | 读取文件，支持分页 | `filePath`, `offset?`, `limit?` |
| `write` | 写入/追加文件，自动创建目录 | `filePath`, `content`, `append?` |
| `edit` | 精确字符串替换 | `filePath`, `oldString`, `newString`, `replaceAll?` |
| `bash` | 执行 shell 命令 | `command`, `workdir?`, `timeout?` |
| `fetch` | 抓取网页并提取内容 | `url`, `format?`, `maxLength?` |
| `search` | DuckDuckGo 网页搜索 | `query`, `maxResults?` |

## 3. 架构

```
@apeira/plugin-common-tools
  │
  ├── plugin (index.ts)  ← AgentPlugin 入口
  │   ├── extendTools() → 按 include/exclude 筛选工具工厂
  │   └── 注册为 pre 阶段插件
  │
  └── tools/             ← 6 个独立工具模块
      ├── read.ts        → Node.js fs.readFile + 流式分页
      ├── write.ts       → Node.js fs.writeFile/appendFile + mkdir
      ├── edit.ts        → 内存中查找替换 + writeFile
      ├── bash.ts        → Node.js child_process.exec
      ├── fetch.ts       → fetch + linkedom + Readability + Turndown
      └── search.ts      → DuckDuckGo Lite + linkedom + Readability
```

## 4. 插件模型

### 4.1 作为 AgentPlugin

```ts
const commonTools = (options?: CommonToolsPluginOptions): AgentPlugin
```

通过 `extendTools()` 注册工具——不污染 instructions、不修改状态、不参与 Turn 生命周期。是最纯粹的"只加工具"型插件。

### 4.2 工具筛选

```ts
type CommonToolsPluginOptions =
  | { include: string[] }    // 白名单模式
  | { exclude: string[] }    // 黑名单模式
  | {}                       // 全部加载
```

```ts
// 只加载 read 和 bash
commonTools({ include: ['read', 'bash'] })

// 加载全部除了 fetch
commonTools({ exclude: ['fetch'] })

// 全部加载
commonTools()
```

**互斥约束**：`include` 和 `exclude` 不能同时出现（TypeScript union 保证）。

## 5. 工具设计细节

### 5.1 read — 流式分页读取

```
全量模式: readFile(filePath, 'utf-8')
部分模式: 逐块读取 + 按行计数 → 精确返回 [offset, offset+limit]
```

**为什么用流式分页而不是 `readFile` + `slice`**：大文件（几 MB 以上）一次读入内存不现实。流式分页只解码需要的行，`Buffer.alloc(65536)` 逐块读取。

**边界处理**：
- `offset` 必须为正整数，`limit` 必须为非负整数
- `limit=0` 直接返回空字符串（而非报错）
- 文件末尾不完整行正常处理

### 5.2 write — 自动创建目录

```ts
await mkdir(dirname(filePath), { recursive: true })
```

Agent 不需要先确认目录存在——直接写，插件自动创建父目录。减少不必要的"先 ls 再 mkdir 再 write"三步操作。

### 5.3 edit — 精确字符串替换

```
单次模式 (replaceAll=false):
  original.indexOf(oldString) → slice + newString + slice

全替换模式 (replaceAll=true):
  original.split(oldString) → join(newString)
```

**为什么是字符串匹配而非正则**：LLM 给的是精确字符串，正则引入转义复杂度且容易出错。`indexOf` 最可靠。

**错误处理**：找不到 `oldString` 时抛错，防止 Agent 以为编辑成功。

### 5.4 bash — 受控 Shell 执行

```ts
exec(command, { timeout: 60_000, maxBuffer: 10MB })
```

| 安全措施 | 值 | 说明 |
|---------|-----|------|
| `timeout` | 60 秒 | 防止失控进程 |
| `maxBuffer` | 10MB | 防止输出爆炸 |
| `workdir` | 可选 | `cd workdir && command` 包装 |

**返回值**：stdout + stderr 拼接。空输出也返回空字符串。

### 5.5 fetch — 网页内容提取

```
fetch(url) → HTML → linkedom 解析 → Readability 提取主体 → Turndown 转 Markdown
```

**管道流程**：

```
1. fetchAsBrowser()         ← Chrome UA + 10MB 大小限制
   ├── 二进制检测 (isBinaryContentType)
   ├── 流式读取 + 大小追踪
   └── charset 自动检测 → TextDecoder

2. linkedom parseHTML()     ← 轻量 DOM (无需 jsdom)
   └── Readability.parse()  ← Mozilla 阅读模式算法

3. sanitize-html            ← 白名单标签 + 属性和协议过滤

4. Turndown                 ← HTML → Markdown (fenced code blocks)
```

**三格式输出**：

| format | 处理方式 |
|--------|---------|
| `markdown`（默认） | Readability + sanitize + Turndown |
| `text` | 移除 script/style/nav/footer/header/aside → `body.textContent` |
| `html` | Readability + sanitize（保留 HTML） |

**元数据块**：标题、作者、来源、发布时间自动前置。

**超时**：30 秒硬超时（`AbortController`）。

### 5.6 search — DuckDuckGo 搜索

```
search("query") → DuckDuckGo Lite (纯 HTML) → linkedom → Readability → text
```

**为什么不用 API**：DuckDuckGo Lite (`lite.duckduckgo.com/lite/`) 不需要 API key，纯 HTML 解析即可。

**结果提取**：按空行分块 → 取前 maxResults（默认 5）个非空块。

## 6. fetchAsBrowser — 模拟浏览器请求

```ts
const BROWSER_HEADERS = {
  'User-Agent': '...Chrome/143.0...',  // 真实 Chrome UA
  'Accept': 'text/html,...',
  'Accept-Language': 'en-US,en;q=0.9',
  // 不包含 cookie / sec-* 头，避免被识别为爬虫但又不触发反爬
}
```

**流式大小限制**：

```ts
// 不是 trust content-length header，而是边读边数
while (true) {
  const { done, value } = await reader.read()
  total += value.byteLength
  if (total > 10MB) throw ...
}
```

防止服务端谎报 `Content-Length` 导致的内存攻击。

## 7. 使用示例

```ts
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'
import { commonTools } from '@apeira/plugin-common-tools'

const agent = createAgent({
  instructions: 'You are a coding assistant.',
  runner: chat({ model: 'gpt-4o' }),
  plugins: [
    commonTools({ exclude: ['fetch', 'search'] }), // 只给文件操作 + bash
  ],
})
```

## 8. 与 plugin-skills 的关系

`commonTools` 提供的是**原子操作**（读/写/编辑/bash）——每个工具在一次调用中完成一个简单任务。

`plugin-skills` 提供的 `skill` 工具则是**知识注入**——加载一整份操作手册到上下文。

两者互补：skills 告诉 Agent 怎么做，common-tools 让 Agent 能做。

## 9. 设计原则

1. **零配置** — 默认全部加载，不强制用户选择
2. **安全默认** — timeout、maxBuffer、maxBodyBytes 都是合理默认值
3. **错误即反馈** — 所有错误以文本形式返回给 Agent，让它自己修正
4. **一个文件一个工具** — 每个工具独立模块，方便单独理解、测试和替换
5. **不依赖外部服务** — search 用 DuckDuckGo（免费无需 key），fetch 直连
6. **轻量解析** — linkedom 替代 jsdom（更小更快），Readability 算法成熟
