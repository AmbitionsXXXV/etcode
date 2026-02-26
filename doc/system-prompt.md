# 环境级系统提示词处理系统设计

> 参考：opencode 系统提示词架构（`SystemPrompt` + `InstructionPrompt`）

## 1. 设计动机

AI Code Agent 在执行任务时，需要感知三类上下文信息：

1. **模型能力边界** — 不同 LLM（Claude / GPT / Gemini）在推理风格、工具调用习惯上存在差异，需要针对性的基础提示词
2. **运行时环境** — 工作目录、Git 状态、操作系统、日期等，让模型理解当前工程上下文
3. **项目/团队规范** — 通过 `AGENTS.md` 等文件注入编码规范、架构约束、团队偏好

传统做法是将所有提示词硬编码在 Agent 定义中。etcode 的设计将提示词分层解耦，实现了 **关注点分离** 和 **运行时动态组合**。

## 2. 三层架构

```text
┌─────────────────────────────────────────────────────┐
│                  SystemPrompt.build()                │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Provider 层 │  │ Environment 层│  │ Instruction │  │
│  │             │  │              │  │   层        │  │
│  │ 模型专属    │  │ 运行时环境    │  │ 项目/全局   │  │
│  │ 基础提示词  │  │ 信息注入      │  │ 指令文件    │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬─────┘  │
│         │                │                 │         │
│         ▼                ▼                 ▼         │
│       string[]  +     string[]    +     string[]     │
│                                                     │
│                  → 合并为最终 system messages →       │
└─────────────────────────────────────────────────────┘
                           │
                           ▼
                    LLM.stream() 调用
```

### 2.1 Provider 层 — `SystemPrompt.provider(modelID)`

按模型 ID 字符串匹配，选择对应的基础提示词模板：

| 模型匹配规则 | 提示词文件 | 适用场景 |
|---|---|---|
| `claude` | `anthropic.txt` | Anthropic Claude 系列 |
| `gpt-` / `o1` / `o3` / `o4` | `openai.txt` | OpenAI GPT / o 系列 |
| `gemini` | `gemini.txt` | Google Gemini 系列 |
| 默认 | `default.txt` | 其他模型 |

**设计决策**：使用 `includes()` 而非精确匹配，兼容模型 ID 的变体（如 `claude-3.5-sonnet`、`gpt-4o-mini`）。

**代码位置**：`packages/etcode/src/session/system.ts`

```typescript
export function provider(modelID: string): string[] {
  if (modelID.includes("claude")) return [PROMPT_ANTHROPIC]
  if (modelID.includes("gpt-") || modelID.includes("o1") || ...)
    return [PROMPT_OPENAI]
  if (modelID.includes("gemini")) return [PROMPT_GEMINI]
  return [PROMPT_DEFAULT]
}
```

### 2.2 Environment 层 — `SystemPrompt.environment()`

收集运行时环境信息，使用 XML 标签结构化输出：

```xml
Here is useful information about the environment you are running in:
<env>
  Working directory: /Users/dev/my-project
  Is directory a git repo: yes
  Platform: darwin
  Today's date: Thu Feb 26 2026
</env>
```

**信息来源**：

| 字段 | 来源 | 说明 |
|---|---|---|
| Working directory | `Instance.directory()` | AsyncLocalStorage 上下文 |
| Git repo | `project.vcs` | 项目发现时检测 |
| Platform | `process.platform` | Node.js 运行时 |
| Date | `new Date().toDateString()` | 当前日期 |

**设计决策**：

- 使用 `<env>` XML 标签包裹，方便 LLM 解析结构化数据
- 不包含敏感信息（如绝对路径中的用户名在实际环境中不可避免，但不包含 API Key 等）
- `vcs` 字段在 `Project.fromDirectory()` 时一次性检测，避免重复 IO

### 2.3 Instruction 层 — `InstructionPrompt.system()`

从三个维度加载指令文件：

```text
项目级（findUpAll 向上遍历）
  ├── ./AGENTS.md
  ├── ./ETCODE.md
  ├── ../AGENTS.md   （向上查找到 git root）
  └── ...
全局级
  └── ~/.config/etcode/AGENTS.md
配置级（etcode.json → instructions）
  ├── .etcode/rules.md          （相对路径）
  ├── /absolute/path/to/rules.md（绝对路径）
  └── https://example.com/rules  （远程 URL）
```

**代码位置**：`packages/etcode/src/session/instruction.ts`

#### 文件搜索策略

```typescript
export async function systemPaths(): Promise<Set<string>> {
  // 1. 项目级：从 cwd 向上遍历到 git root
  const found = await Filesystem.findUpAll(
    INSTRUCTION_FILES, Instance.directory(), root
  )

  // 2. 全局级：~/.config/etcode/AGENTS.md
  const globalPath = path.join(Global.Path.config, "AGENTS.md")

  // 3. 配置级：config.instructions 中的路径
  for (let instruction of config.instructions) { ... }

  return paths  // Set<string> 自动去重
}
```

#### URL 加载策略

- 使用 `AbortSignal.timeout(5000)` 实现 5 秒超时
- 失败静默降级（日志记录，不中断主流程）
- 与文件加载并发执行（`Promise.all`）

## 3. 组合流程

`SystemPrompt.build()` 是整个系统的入口，按优先级组合三层提示词：

```text
输入: { agent: Agent.Info, modelID?: string }

Step 1: Agent 自身提示词 OR Provider 提示词
  ├── agent.prompt 存在 → 使用 agent.prompt（跳过 Provider）
  └── agent.prompt 不存在 → 使用 SystemPrompt.provider(modelID)

Step 2: 环境信息
  └── SystemPrompt.environment()

Step 3: 指令文件
  └── InstructionPrompt.system()

输出: string[]（每个元素 = 一条 system message）
```

**核心代码**：

```typescript
export async function build(input: {
  agent: Agent.Info
  modelID?: string
}): Promise<string[]> {
  const parts: string[] = []

  // Agent prompt 优先于 Provider prompt
  if (input.agent.prompt) {
    parts.push(input.agent.prompt)
  } else if (input.modelID) {
    parts.push(...provider(input.modelID))
  } else {
    parts.push(...provider(""))
  }

  parts.push(...environment())

  const instructions = await InstructionPrompt.system()
  parts.push(...instructions)

  return parts.filter(Boolean)
}
```

## 4. 完整数据流

```text
CLI: etcode run "implement feature X" --agent build
  │
  ▼
bootstrap() → Instance.provide({ directory })
  │
  ▼
Agent.get("build") → agent.prompt = build.txt 内容
  │
  ▼
SystemPrompt.build({ agent, modelID })
  │
  ├─ [1] agent.prompt → "You are an expert software engineer..."
  │
  ├─ [2] environment() → "<env>Working directory: /dev/proj...</env>"
  │
  ├─ [3] InstructionPrompt.system()
  │    ├─ systemPaths()
  │    │   ├─ findUpAll(["AGENTS.md","ETCODE.md"], cwd, gitRoot)
  │    │   ├─ ~/.config/etcode/AGENTS.md
  │    │   └─ config.instructions 解析
  │    │
  │    ├─ 并发读取所有文件 + 拉取 URL
  │    └─ ["Instructions from: /proj/AGENTS.md\n...", ...]
  │
  ▼
string[] → system messages → LLM API 调用
```

## 5. 配置示例

### etcode.json

```json
{
  "provider": [
    { "id": "anthropic", "apiKey": "sk-...", "model": "claude-sonnet-4-20250514" }
  ],
  "instructions": [
    ".etcode/rules.md",
    "~/global-rules.md",
    "https://team.example.com/coding-standards.md"
  ]
}
```

### 项目 AGENTS.md

```markdown
# 项目规范

- 使用 TypeScript strict mode
- 所有导出函数需要 JSDoc 注释
- 测试覆盖率不低于 80%
- 使用 pnpm 作为包管理器
```

## 6. 与 opencode 的对比分析

| 维度 | opencode | etcode | 设计考量 |
|---|---|---|---|
| Provider 匹配 | 6 个模板（anthropic, beast, gemini, codex, trinity, qwen） | 4 个模板（anthropic, openai, gemini, default） | etcode 简化分类，降低维护成本 |
| 环境信息 | 包含模型 ID、`<directories>` 占位 | 专注核心 4 字段 | 避免信息过载，按需扩展 |
| 指令搜索 | `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` + glob 模式 | `AGENTS.md` / `ETCODE.md` + 直接路径 | 去掉过时文件名，简化匹配逻辑 |
| URL 指令 | `fetch` + 5s 超时 | 同 | 保持一致的降级策略 |
| Plugin 系统 | `experimental.chat.system.transform` hook | 预留扩展点（未实现） | 首版聚焦核心，Plugin 后续迭代 |
| 路径去重 | `Set<string>` | `Set<string>` | 保持一致 |
| Agent 优先级 | `agent.prompt` > `provider()` | 同 | Agent 自定义优先于通用模板 |
| Codex 特殊处理 | `isCodex` 分支 + `options.instructions` | 无 | etcode 不需要 OAuth 特殊逻辑 |

## 7. 关键设计决策

### 7.1 为什么 Agent prompt 优先于 Provider prompt？

Agent 是用户显式配置或系统精心设计的角色定义，其提示词包含了角色边界、权限描述、行为约束等关键信息。Provider 提示词只是通用的模型调优，当 Agent 已有定制提示词时，Provider 层就变得冗余。

### 7.2 为什么使用 XML 标签包裹环境信息？

1. **结构化解析** — LLM 对 XML 标签的解析能力强于纯文本分隔符
2. **边界清晰** — `<env>...</env>` 让模型明确知道环境信息的起止位置
3. **行业惯例** — Anthropic 官方推荐使用 XML 标签组织系统提示词

### 7.3 为什么指令文件查找向上遍历到 git root？

Monorepo 场景下，根目录的 `AGENTS.md` 包含全局规范，子目录的 `AGENTS.md` 包含模块级规范。向上遍历确保两层规范都能被加载。以 git root 为边界，避免遍历出项目范围。

### 7.4 为什么 URL 加载使用 5 秒超时？

团队共享的远程规范文件不应阻塞 Agent 启动。5 秒是经验值：

- 正常 CDN 响应 < 500ms
- 网络抖动场景下 < 3s
- 超过 5s 大概率是网络故障，不值得等待

## 8. 性能考量

| 场景 | 策略 | 时间复杂度 |
|---|---|---|
| Provider 匹配 | 纯字符串 `includes()`，同步执行 | O(1) |
| 模板加载 | `fs.readFileSync` 在模块加载时一次性读取 | 启动时 O(n)，运行时 O(1) |
| 环境收集 | `Instance` 上下文直接读取，无 IO | O(1) |
| 指令文件查找 | `findUpAll` 向上遍历，最多到 git root | O(depth * files) |
| 指令文件读取 | `Promise.all` 并发读取所有文件 + URL | O(max latency) |
| 路径去重 | `Set<string>` | O(n) |

**总体**：`SystemPrompt.build()` 的开销主要在 IO（文件读取 + 网络请求），通过并发和超时控制将延迟降到最低。

## 9. 可扩展性

### 9.1 新增 Provider 支持

添加新模型只需：

1. 创建 `packages/etcode/src/session/prompt/{name}.txt`
2. 在 `SystemPrompt.provider()` 添加匹配规则

### 9.2 新增环境信息字段

在 `SystemPrompt.environment()` 的数组中追加一行即可，如：

```typescript
`  Shell: ${process.env.SHELL ?? "unknown"}`,
`  Node version: ${process.version}`,
```

### 9.3 Plugin Hook 预留

未来可在 `SystemPrompt.build()` 中加入 Plugin 触发点：

```typescript
await Plugin.trigger("system.prompt.transform", { agent }, { system: parts })
```

允许插件在最终发送前修改系统提示词。

### 9.4 Instruction 层嵌套

未来可实现类似 opencode 的 `resolve()` 方法 — 当工具读取某个目录的文件时，自动查找该目录的 `AGENTS.md` 并注入为上下文指令。

## 10. 文件清单

| 文件 | 类型 | 职责 |
|---|---|---|
| `session/system.ts` | 新建 | `SystemPrompt` 命名空间：provider / environment / build |
| `session/instruction.ts` | 新建 | `InstructionPrompt` 命名空间：systemPaths / system / find |
| `session/prompt/anthropic.txt` | 新建 | Claude 系列基础提示词 |
| `session/prompt/openai.txt` | 新建 | GPT 系列基础提示词 |
| `session/prompt/gemini.txt` | 新建 | Gemini 系列基础提示词 |
| `session/prompt/default.txt` | 新建 | 默认基础提示词 |
| `config/config.ts` | 修改 | 增加 `instructions` 配置字段 |
| `util/filesystem.ts` | 修改 | 增加 `findUpAll()` 方法 |
| `project/project.ts` | 修改 | 增加 `vcs` 字段 |

## 11. 面试常见问题

### Q1: 为什么要把系统提示词分三层，而不是一个大字符串？

**关注点分离（Separation of Concerns）**。Provider 层关注模型特性调优，Environment 层关注运行时感知，Instruction 层关注项目规范。三层独立变化、独立测试，修改一层不影响其他层。这与 CSS 的 User-Agent / Author / User 三层样式表概念类似。

### Q2: `findUpAll` 和 `findUp` 的区别是什么？为什么需要两个？

`findUp` 找到第一个匹配就返回（用于 `.git` 目录检测），`findUpAll` 收集所有匹配（用于 Monorepo 中多层级的 `AGENTS.md`）。Monorepo 中子包和根目录可能各有一份指令文件，都需要加载。

### Q3: URL 指令加载失败时如何处理？

**静默降级（Graceful Degradation）**。`fetch` 配合 `AbortSignal.timeout(5000)` 设置超时，`.catch()` 捕获所有异常（网络错误、超时、DNS 解析失败等），返回空字符串。日志记录失败原因用于排查，但不影响主流程。这确保了 Agent 在网络不可用时仍能正常工作。

### Q4: 如果同一个 AGENTS.md 被多个路径引用，会重复加载吗？

不会。`systemPaths()` 返回 `Set<string>`，所有路径经过 `path.resolve()` 标准化后存入 Set，天然去重。即使 `./AGENTS.md` 和 `config.instructions` 中 `/absolute/path/AGENTS.md` 指向同一文件，只要 resolve 后相同就只加载一次。

### Q5: 为什么 Provider 模板在模块加载时就读取，而不是按需读取？

**启动时预加载 vs 运行时懒加载的权衡**。Provider 模板数量固定且体积小（< 1KB），启动时一次性加载到内存避免了每次调用的 IO 开销。这是经典的 **空间换时间** 策略，适用于读多写少的配置型数据。

### Q6: 这个设计如何支持 Monorepo？

通过 `findUpAll()` 的 `root` 参数。以 git root 为遍历边界，从当前工作目录向上查找所有 `AGENTS.md`。例如在 `packages/foo/src/` 目录工作时，可以同时加载 `packages/foo/AGENTS.md`（包级规范）和根目录的 `AGENTS.md`（全局规范），实现分层覆盖。

### Q7: 如果未来需要支持 `.cursorrules` 等其他规范文件怎么办？

只需在 `INSTRUCTION_FILES` 数组中追加文件名即可。`findUpAll` 和 `find` 都基于这个数组遍历，零代码改动就能扩展支持的文件类型。

### Q8: 系统提示词的最终顺序为什么重要？

LLM 对系统提示词中靠前内容的关注度通常更高（primacy effect）。因此 Agent 核心角色定义排在最前，环境信息次之（每次调用都变，需要模型关注），指令文件排在最后（通常是补充规范）。这个顺序也与 opencode 保持一致。
