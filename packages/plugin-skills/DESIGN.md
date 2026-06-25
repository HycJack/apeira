# @apeira/plugin-skills — Skill System

## 1. 定位

`@apeira/plugin-skills` 是 Apeira 的**技能系统**——一种结构化的知识注入机制。每个 Skill 是一份 Markdown 文件（含 YAML 前置元数据），由插件在运行时加载并注入到 Agent 的系统提示中，LLM 通过工具调用按需激活。

```
Skill 文件 (SKILL.md) → SkillSet → 插件 → available_skills 提示 + skill / skill_reference 工具
```

**核心价值**：将"给 LLM 看操作手册"这件事标准化——技能可版本管理、可热重载、可按 token 预算裁剪。

## 2. 核心概念

### 2.1 Skill

```ts
interface Skill {
  name: string               // 唯一标识（从 SKILL.md frontmatter 或目录名）
  description: string         // 简短描述，用于 available_skills 列表
  filePath: string            // SKILL.md 的绝对路径
  content: string             // Markdown 正文（去掉 frontmatter 之后）
  references?: SkillReference[] // 附属文件引用
}
```

**SKILL.md 格式**：

```markdown
---
name: brandkit
description: Premium brand-kit image generation skill...
---

# 正文内容
...
```

### 2.2 SkillReference

```ts
interface SkillReference {
  path: string         // 相对 skill 文件的路径
  description?: string  // 可选描述
  content?: string     // 延迟加载的内容
}
```

Skill 目录下可以有一个 `references/` 子目录，存放辅助文件（如模板、示例配置）。引用文件通过 `skill_reference` 工具按需加载。

### 2.3 SkillSet

```ts
interface SkillSet {
  getSkills: () => Skill[]                       // 获取当前全部技能
  getSkill: (name: string) => Skill | undefined  // 按名查找
  getSkillReference: (skillName, path) => Promise<SkillReference | undefined>
  getDiagnostics: () => SkillDiagnostic[]        // 加载过程中的警告/错误
  refresh: () => Promise<SkillSetSnapshot>       // 重新加载
  priority?: number                               // 合并时的优先级
}
```

SkillSet 是技能集合的**抽象接口**——不关心技能来源，只提供读取和刷新。

## 3. 架构

```
@apeira/plugin-skills
  │
  ├── types/                    ← Skill, SkillSet, SkillReference 等类型
  │
  ├── utils/
  │   ├── plugin.ts             ← skills() AgentPlugin 入口
  │   ├── skill-set.ts          ← createSkillSet, mergeSkillSets
  │   ├── format.ts             ← 提示格式化 + token 预算裁剪
  │   └── tools.ts              ← skill 工具 + skill_reference 工具
  │
  └── fs.ts                     ← fsSkillSet() 文件系统数据源
```

## 4. SkillSet 可变来源

### 4.1 静态 Skill 列表

```ts
const skillSet = createSkillSet({
  skills: [
    { name: 'my-skill', description: '...', content: '...', filePath: '/...' },
  ],
})
```

最简单的方式——直接传参，无刷新机制。

### 4.2 动态加载函数

```ts
const skillSet = createSkillSet({
  loadSkills: async () => {
    // 从数据库 / API / 文件系统加载
    return { skills: [...], diagnostics: [...] }
  },
})
```

每次 `refresh()` 调用 `loadSkills()` 重新获取。

### 4.3 文件系统数据源 (fsSkillSet)

```ts
import { fsSkillSet } from '@apeira/plugin-skills/fs'

const skillSet = fsSkillSet({
  directory: './skills',
  allowedReferenceExtensions: ['.md', '.mdx', '.txt'],
})
```

**目录结构约定**：

```
skills/
├── brandkit/
│   ├── SKILL.md              ← 技能主体
│   └── references/
│       └── templates.md      ← 附属文件
├── cavecrew/
│   └── SKILL.md
└── ...
```

每个子目录 = 一个 Skill，子目录名 = 默认 name（可被 frontmatter 覆盖）。隐藏目录（`.` 开头）被跳过。

**加载流程**：

```
fsSkillSet.refresh()
  │
  ├── readdir(directory)
  ├── 跳过 . 开头目录
  ├── 对每个子目录:
  │   ├── readFile(SKILL.md)
  │   ├── parseFrontmatter → { name?, description? }
  │   ├── collectReferenceFiles(references/)
  │   │   └── 递归遍历 + 扩展名过滤
  │   └── → Skill{ name, description, content, filePath, references }
  │
  └── 按 name 排序后返回
```

**parseFrontmatter**：

```ts
// 正则匹配 YAML frontmatter 块
const match = /^\uFEFF?---\s*\n([\s\S]*?)\n---/
// → yaml.parse() → attrs
// → body = content.slice(match[0].length)
```

**安全性**：`getSkillReference` 对路径做 `path.resolve` → `path.relative` 检查，拒绝 `..` 逃逸。

## 5. 插件行为

### 5.1 extendInstructions — 技能清单注入

```ts
formatSkillsForSystemPrompt(skills, instructionsBudget)
```

生成如下 XML 块注入到系统提示末尾：

```xml
The following skills provide specialized instructions...

<available_skills>
  <skill>
    <name>brandkit</name>
    <description>Premium brand-kit image generation skill...</description>
    <location>skills/brandkit/SKILL.md</location>
  </skill>
  ...
</available_skills>
```

### 5.2 Token 预算裁剪

```ts
instructionsBudget = options.instructionsBudget ?? state.contextLength * 0.02
```

| contextLength | 预算 (2%) | 字符预算 (×4) |
|---------------|-----------|---------------|
| 128,000 | 2,560 tokens | 10,240 chars |
| 200,000 | 4,000 tokens | 16,000 chars |

**四级裁剪策略**（在 `formatSkillsForSystemPrompt` 中实现）：

```
策略 1: 完整渲染
  如果所有 skill 的 name + description + location 都放得下
  → 全部输出

策略 2: 描述截断
  如果去掉描述全用 name+location 放得下
  → 二分查找最优截断长度 truncateDesc
  → 如果最佳截断长度 >= 15 chars，使用截断
  → 否则降级到策略 3

策略 3: 省略描述
  只输出 name + location，不要 description
  → 用于预算紧张时

策略 4: 尾部裁剪
  从末尾开始逐个移除 skill
  → 优先保留前面的 skill（用户定义的顺序）
  → 保底策略
```

**CHARS_PER_TOKEN = 4**：近似估算，英文 1 token ≈ 4 chars。

### 5.3 extendTools — 两个工具

#### skill 工具

```
名称: skill (可自定义 toolName)
功能: 传入 skill name → 返回完整 skill 内容 + references 清单
```

```ts
skill({ name: 'brandkit', additionalInstructions: '生成一个 dark theme 的版本' })
```

返回格式：

```xml
<skill name="brandkit" location="skills/brandkit/SKILL.md">
References are relative to skills/brandkit.

Available references...:
- templates.md: 模板文件

[skill 正文 content...]
</skill>

[additionalInstructions 如果有]
```

#### skill_reference 工具

```
名称: skill_reference (可自定义 referenceToolName)
功能: 传入 skill name + reference path → 返回引用文件内容
```

```ts
skill_reference({ name: 'brandkit', path: 'templates.md' })
```

返回格式：

```xml
<skill_reference skill="brandkit" path="templates.md">
[templates.md 内容]
</skill_reference>
```

**条件创建**：只有当至少一个 skill 有 `references` 时才注册此工具。

### 5.4 刷新模式

| refresh | 行为 |
|---------|------|
| `'turn'` | 每个 Turn 开始时自动刷新（适合 fsSkillSet，编辑即生效） |
| `'manual'` | 仅在 `init()` 时加载一次 |

有 `sets` 时的默认值为 `'turn'`，否则为 `'manual'`。

刷新通过监听 `apeira` channel 的 `turn.start` 事件触发。

## 6. SkillSet 合并

```ts
const merged = mergeSkillSets([baseSet, projectSet, userSet])
```

**去重规则**：按 `priority` 降序排列，同名 skill 高优先级覆盖低优先级。合并后的结果：

- `getSkills()` 返回去重后的全部 skill
- `getSkill(name)` 在排序后的 set 列表中查找
- `getSkillReference()` 委托给第一个包含该 skill 的 set
- `getDiagnostics()` 汇总所有 set 的诊断
- `refresh()` 刷新所有 set 并重新去重

## 7. 完整数据流

```
Agent 启动
  │
  ▼
plugin.init()
  ├── 如有 sets → mergeSkillSets(sets)
  ├── 如有 skills → createSkillSet({ skills })
  └── 否则 → createSkillSet() (空)
  │
  ├── refresh='turn' → 监听 turn.start → refresh()
  │
  ▼
每个 Turn:
  │
  ├── extendInstructions({ state })
  │   → skillSet.getSkills()
  │   → formatSkillsForSystemPrompt(skills, budget)
  │   → 注入 available_skills 块
  │
  ├── extendTools()
  │   → skillSet.getSkills()
  │   → createSkillTool(skillSet)      ← 总是创建
  │   → createSkillReferenceTool(skillSet) ← 条件创建
  │
  ▼
LLM 收到 available_skills 列表
  │
  ├── 匹配到某 skill → 调用 skill({ name, additionalInstructions })
  │   → 返回完整 skill 内容 + references 清单
  │
  ├── 需要 reference → 调用 skill_reference({ name, path })
  │   → 返回引用文件内容
  │
  ▼
LLM 基于 skill 内容完成任务
```

## 8. 使用示例

### 基本使用

```ts
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

const agent = createAgent({
  plugins: [
    skills({
      sets: [fsSkillSet({ directory: './skills' })],
    }),
  ],
})
```

### 多个 SkillSet 合并

```ts
skills({
  sets: [
    fsSkillSet({ directory: './shared-skills', priority: 1 }),
    fsSkillSet({ directory: './project-skills', priority: 10 }),  // 更高优先级
  ],
  instructionsBudget: 1000,  // 固定 1000 token 预算
})
```

### 自定义工具名

```ts
skills({
  toolName: 'load_skill',
  referenceToolName: 'load_reference',
  sets: [...],
})
```

## 9. 设计原则

1. **延迟加载** — Skill 内容不在 init 时全量注入，而是通过工具按需激活
2. **预算感知** — 四级裁剪自动适配不同上下文窗口
3. **热重载** — `turn` 模式编辑即生效，无需重启 Agent
4. **来源无关** — SkillSet 抽象不关心数据来自文件系统、数据库还是 API
5. **合并可组合** — 优先级去重模型允许多个来源叠加
6. **引用安全** — `references/` 内容通过路径检查防逃逸
7. **XML 标记** — Skill 内容用 XML 标签包裹，帮助 LLM 区分"当前任务"和"参考手册"
