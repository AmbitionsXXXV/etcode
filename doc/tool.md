# Tool 执行与构建引擎

> 完整复刻 opencode 全部 tool 系统

## 概述

Tool 模块是 etcode 的核心执行引擎，负责定义、注册和执行 LLM 可用的所有工具。每个工具通过 `Tool.define()` 定义，经 `ToolRegistry` 注册，最终传递给 `LLM.stream({ tools })` 供模型调用。

## 架构

```text
Tool.define(id, init)
  ↓
Tool.Info { id, init() → { description, parameters, execute() } }
  ↓
ToolRegistry.all() → 内置 + 自定义工具列表
  ↓
ToolRegistry.tools(model, agent) → 按模型/Agent 过滤 + 初始化
  ↓
LLM.stream({ tools }) → 模型调用工具 → tool.execute(args, ctx)
  ↓
Truncate.output() → 输出截断保护
```

## 核心接口

### Tool.Info

```typescript
interface Info<Parameters, Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<{
    description: string
    parameters: Parameters  // Zod schema
    execute(args, ctx: Context): Promise<{
      title: string
      metadata: Metadata
      output: string
    }>
  }>
}
```

### Tool.Context

```typescript
type Context = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  metadata(input): void  // 流式更新元数据
  ask(input): Promise<void>  // 请求权限
}
```

### Tool.define()

辅助函数，自动处理：

- Zod 参数验证（含自定义格式化错误）
- 输出截断（`Truncate.output()`）
- 支持同步或异步 init

## 工具列表

| ID | 文件 | 说明 | 条件 |
|----|------|------|------|
| invalid | invalid.ts | 无效工具调用占位 | 始终 |
| question | question.ts | 向用户提问交互 | 始终 |
| bash | bash.ts | Shell 命令执行 | 始终 |
| read | read.ts | 读取文件或目录 | 始终 |
| glob | glob.ts | Glob 文件搜索 | 始终 |
| grep | grep.ts | Ripgrep 内容搜索 | 始终 |
| edit | edit.ts | 搜索替换编辑 | 非 apply_patch 模式 |
| write | write.ts | 写入文件 | 非 apply_patch 模式 |
| task | task.ts | 子 Agent 委托 | 始终 |
| webfetch | webfetch.ts | URL 内容抓取 | 始终 |
| todowrite | todo.ts | 任务列表管理 | 始终 |
| websearch | websearch.ts | Exa 网页搜索 | experimental.websearch |
| skill | skill.ts | 技能加载 | 始终 |
| apply_patch | apply_patch.ts | 统一补丁应用 | GPT 模型 |
| batch | batch.ts | 批量并行执行 | experimental.batch_tool |
| plan_exit | plan.ts | 计划模式退出 | 始终 |

## 模糊匹配链（edit.ts）

EditTool 支持 9 种替换策略，按优先级依次尝试：

1. **SimpleReplacer** — 精确匹配
2. **LineTrimmedReplacer** — 忽略行首尾空白
3. **BlockAnchorReplacer** — 首尾行锚定 + Levenshtein 相似度
4. **WhitespaceNormalizedReplacer** — 空白规范化
5. **IndentationFlexibleReplacer** — 缩进灵活匹配
6. **EscapeNormalizedReplacer** — 转义字符规范化
7. **TrimmedBoundaryReplacer** — 边界修剪匹配
8. **ContextAwareReplacer** — 上下文感知匹配
9. **MultiOccurrenceReplacer** — 多次出现匹配

## ToolRegistry

### 过滤逻辑

- `apply_patch` — 仅 GPT 模型（排除 oss 和 gpt-4）
- `edit` / `write` — 与 `apply_patch` 互斥
- `websearch` — 需要 `experimental.websearch` 配置
- `batch` — 需要 `experimental.batch_tool` 配置

### 自定义工具

通过 `ToolRegistry.register(tool)` 注册自定义工具，支持动态扩展。

## 输出截断

- 默认限制：2000 行 / 50KB
- 超出后写入 `~/.local/share/etcode/tool-output/`
- 提示使用 Grep / Read 查看完整内容
- 工具可通过 `metadata.truncated` 跳过自动截断

## 外部目录检查

当工具访问项目目录之外的路径时，`assertExternalDirectory()` 会通过 `ctx.ask()` 请求 `external_directory` 权限。

## 描述文件

每个工具对应一个 `.txt` 描述文件，内容作为 LLM 看到的 `tool.description`，对模型行为至关重要。支持模板变量替换（如 `${directory}`、`${maxLines}`）。

## 配置

```json
{
  "experimental": {
    "batch_tool": true,
    "websearch": true,
    "plan_mode": true
  }
}
```

## 依赖

| 包 | 用途 |
|----|------|
| diff | diff 计算（edit/write/apply_patch） |
| turndown | HTML 转 Markdown（webfetch） |
| zod | 参数校验 |

## 文件结构

```text
src/tool/
├── tool.ts              # 核心接口 + define()
├── truncation.ts        # 输出截断
├── external-directory.ts # 外部目录权限检查
├── registry.ts          # ToolRegistry
├── types.d.ts           # .txt 模块声明
├── invalid.ts           # InvalidTool
├── bash.ts + bash.txt
├── read.ts + read.txt
├── write.ts + write.txt
├── edit.ts + edit.txt
├── glob.ts + glob.txt
├── grep.ts + grep.txt
├── task.ts + task.txt
├── webfetch.ts + webfetch.txt
├── websearch.ts + websearch.txt
├── todo.ts + todowrite.txt
├── question.ts + question.txt
├── skill.ts
├── apply_patch.ts + apply_patch.txt
├── batch.ts + batch.txt
└── plan.ts + plan-exit.txt
```
