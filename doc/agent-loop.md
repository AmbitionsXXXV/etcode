# Agent Loop 实现

> 核心 agent loop 模块，将 LLM 流式调用、工具执行、消息持久化串联为完整的对话循环。

## 概述

Agent Loop 由两个核心模块组成：

- `prompt.ts` — 循环控制器，负责消息管理、退出判断、工具集构建
- `processor.ts` — 流处理器，负责消费 AI SDK stream 事件、持久化 Part、错误重试

## 架构

```text
CLI run.ts
  ↓
Prompt.prompt(input)
  → Message.create(user)
  → Session.touch()
  → Prompt.loop()

Prompt.loop()
  ├─ start(sessionID) → AbortController
  ├─ Agent.get() + resolveModel()
  ├─ SystemPrompt.build()
  └─ while (true):
       ├─ Message.list() → 加载历史
       ├─ 检查退出条件 (finish + 无 pending tool calls)
       ├─ Message.create(assistant)
       ├─ toModelMessages() → ModelMessage[]
       ├─ buildToolSet() → ToolSet
       ├─ Processor.process() → stream 消费
       └─ result === "stop" → break

Processor.process()
  ├─ LLM.stream() → fullStream
  ├─ for await (value of fullStream):
  │    ├─ text-start → Part.createText()
  │    ├─ text-delta → Bus.publish(Part.Event.Delta)
  │    ├─ text-end → Part.update()
  │    ├─ tool-call → Part.createTool(running)
  │    ├─ tool-result → Part.update(completed)
  │    ├─ tool-error → Part.update(failed)
  │    ├─ finish-step → Message.update(tokens)
  │    └─ error → throw
  ├─ catch: retryable? → sleep + retry
  └─ catch: non-retryable → Session.Event.Error
```

## 模块详情

### prompt.ts

#### `Prompt.prompt(input)`

入口函数，接收用户输入并启动 agent loop。

参数：

- `projectID` — 项目 ID
- `sessionID` — 会话 ID
- `content` — 用户消息内容
- `agent` — Agent 名称
- `model` — 可选的模型覆盖

流程：

1. 创建 user message
2. 更新 session 时间戳
3. 调用 `loop()`

#### `Prompt.loop(input)`

核心循环，每轮执行：

1. 加载所有消息
2. 检查退出条件（assistant 已完成且无 pending tool calls）
3. 创建新的 assistant message
4. 将历史消息转换为 `ModelMessage[]`
5. 构建 `ToolSet`（从 ToolRegistry 获取，按权限过滤）
6. 调用 `Processor.process()` 执行 LLM 流式调用
7. 根据结果决定继续或退出

退出条件：

- `abort.aborted` — 用户取消
- `step >= maxSteps` — 达到最大步数
- `lastAssistant.finish !== "tool-calls"` 且无 pending tool calls — 正常完成
- `Processor.process()` 返回 `"stop"` — 错误或中止

#### `cancel(sessionID)`

取消指定会话的 agent loop，通过 AbortController 传播中止信号。

#### `toModelMessages(projectID, messages)`

将 `Message.Info[]` + `Part.Info[]` 转换为 AI SDK `ModelMessage[]` 格式：

- user message → `{ role: "user", content: text }`
- assistant text parts → `{ role: "assistant", content: [{ type: "text", text }] }`
- assistant tool parts → `{ role: "assistant", content: [{ type: "tool-call", ... }] }` + `{ role: "tool", content: [{ type: "tool-result", ... }] }`

#### `buildToolSet(input)`

从 `ToolRegistry.tools()` 获取工具列表，按 `Permission.disabled()` 过滤，然后包装为 AI SDK `ToolSet`。每个工具通过 `tool()` 创建，传入 Zod schema 作为 `inputSchema`，并提供 `execute` 回调构建 `Tool.Context`。

### processor.ts

#### `Processor.process(input)`

消费 LLM stream 并持久化所有事件为 Part。

返回值：

- `"continue"` — 正常完成，loop 可继续
- `"stop"` — 错误或中止，loop 应退出

错误重试：

- 识别可重试错误（rate limit、overloaded、timeout）
- 指数退避：`1s × 2^(attempt-1)`，最大 30s
- 最多重试 5 次
- 不可重试错误直接发布 `Session.Event.Error`

## Bus 事件

| 事件 | 触发时机 | 用途 |
|------|----------|------|
| `Part.Event.Updated` | Part 创建或更新 | TUI 显示工具状态 |
| `Part.Event.Delta` | 文本流式增量 | TUI 实时输出文本 |
| `Session.Event.Error` | 不可重试错误 | TUI 显示错误信息 |
| `Message.Event.Created` | 消息创建 | 消息追踪 |

## Message Schema 扩展

`AssistantMessage` 新增字段：

- `finish` — finishReason（"stop"、"tool-calls" 等）
- `error` — 错误信息
- `tokens` — `{ input, output }` token 用量
- `time.completed` — 完成时间戳

## Part Schema 扩展

`ToolState` 新增字段：

- `title` — 工具执行标题
- `time` — `{ start, end }` 执行时间

`ToolPart` 新增字段：

- `callID` — AI SDK tool call ID，用于关联 tool-call 和 tool-result

## TUI 集成

### 非交互模式 (`etcode run`)

`run.ts` 通过 Bus 订阅实现实时输出：

- `Part.Event.Delta` — `process.stdout.write(delta)` 实时打印文本
- `Part.Event.Updated` — 打印工具调用状态（running/completed/failed）
- `Session.Event.Error` — 打印错误信息

### 交互模式 (`etcode .`)

`tui/app.tsx` 通过 Bus 订阅驱动 React (Ink) 组件更新：

- `Message.Event.Created` — 添加或更新消息到 messages 列表
- `Part.Event.Updated` — 更新对应消息的 parts 列表
- `Part.Event.Delta` — 累积流式文本到 streaming buffer，实时渲染
- `Session.Event.Error` — 显示错误提示

详见 `doc/tui.md`。

## 持久化

Session、Message、Part 使用 SQLite (better-sqlite3 + Drizzle ORM) 持久化。数据库文件位于 `~/.local/share/etcode/etcode.db`。Message 和 Part 使用 JSON `data` 列存储灵活数据结构。

详见 `doc/storage.md`。

## 文件结构

```text
src/session/
├── prompt.ts       # Agent loop 入口 (prompt + loop + cancel + toModelMessages + buildToolSet)
├── processor.ts    # Stream 处理器 (process + 错误重试)
├── llm.ts          # AI SDK streamText 包装
├── message.ts      # 消息 CRUD + schema (Drizzle)
├── part.ts         # Part CRUD + schema + Delta 事件 (Drizzle)
├── session.ts      # Session CRUD + Error 事件 (Drizzle)
├── session.sql.ts  # Drizzle 表定义 (SessionTable, MessageTable, PartTable, TodoTable)
├── system.ts       # 系统提示构建
├── instruction.ts  # AGENTS.md / ETCODE.md 加载
└── prompt/         # 各 provider 系统提示模板
```

## 依赖

| 包 | 用途 |
|----|------|
| ai | AI SDK streamText、tool、ModelMessage |
| zod | 参数校验、schema 定义 |
