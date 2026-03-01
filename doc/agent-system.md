# Etcode Agent System 架构文档

## 概述

Etcode 的 Agent 系统是一个基于递归循环的 LLM 代理架构，支持多代理协作、工具编排、权限控制和上下文管理。

## 核心模块

### 1. Agent 定义 (`agent/agent.ts`)

每个 Agent 是一个带有名称、权限规则集、可选模型绑定和系统提示词的配置单元。

内置 Agent：

| Agent | 模式 | 用途 |
|-------|------|------|
| build | primary | 默认代理，具备完整工具权限 |
| plan | primary | 只读规划模式，禁止编辑工具 |
| general | subagent | 通用子代理，多步骤任务 |
| explore | subagent | 只读代码探索 |
| compaction | primary (hidden) | 上下文压缩 |
| title | primary (hidden) | 会话标题生成 |
| summary | primary (hidden) | 会话摘要 |

### 2. 会话循环 (`session/prompt.ts`)

核心入口：`Prompt.prompt()` -> `Prompt.loop()`

循环逻辑：

1. 设置会话状态为 `busy`
2. 加载历史消息，检查退出条件
3. 检查是否有待处理的 compaction part
4. 检查 token 是否溢出上下文窗口
5. 第一步时异步触发标题生成
6. 构建 ToolSet（注册工具 - 权限过滤 - AI SDK 包装）
7. 调用 `Processor.process()` 消费 LLM 流
8. 根据 `finish reason` 决定继续循环或退出
9. 退出后执行 prune 和 summarize

### 3. 流处理器 (`session/processor.ts`)

- 消费 `LLM.stream()` 的 `fullStream`
- 按事件类型分发：`text-start/delta/end`、`tool-call`、`tool-result`、`tool-error`、`finish-step`
- 指数退避重试（rate limit、overload、timeout）
- 每步开始/结束记录 git snapshot

### 4. 工具系统 (`tool/`)

工具注册：`Tool.define(id, init)` -> `ToolRegistry.tools(model, agent)`

工具执行上下文 (`Tool.Context`)：

- `sessionID`、`messageID` — 定位当前会话
- `abort` — 取消信号
- `metadata()` — 更新工具运行状态
- `ask()` — 触发权限检查

模型适配：GPT 系列使用 `apply_patch`，其他使用 `edit`/`write`。

### 5. 权限系统 (`permission/permission.ts`)

三级动作：`allow`（自动放行）、`deny`（自动拒绝）、`ask`（等待用户确认）

规则评估：最后匹配规则生效（last-match-wins），支持通配符。

流程：

```text
tool.execute -> ctx.ask() -> Permission.ask()
  -> evaluate(permission, pattern, ruleset)
  -> allow: 直接返回
  -> deny: 抛出 DeniedError
  -> ask: 发布 permission.asked 事件，等待 reply()
```

### 6. 上下文压缩 (`session/compaction.ts`)

触发条件：`tokens.input + tokens.output >= context_limit - buffer`

处理流程：

1. 使用 compaction agent 调用 LLM
2. 传入全部历史消息 + 压缩提示模板
3. 生成结构化摘要（Goal / Instructions / Discoveries / Accomplished / Files）
4. 标记为 summary 消息，后续循环遇到 summary 消息时重置上下文

Prune 机制：回溯历史工具调用，保留最近 40K token 的输出，裁剪更早的工具输出。

### 7. 子代理 (`tool/task.ts`)

工作流程：

1. 权限检查 `task` permission
2. 创建/恢复子会话
3. 调用 `Prompt.prompt()` 在子会话中执行完整代理循环
4. 监听父会话 abort 信号，联动取消子会话
5. 提取子会话最后的 text 输出作为结果返回

### 8. 标题生成 (`session/title.ts`)

在代理循环的第一步异步触发，使用 title agent 和低温度生成 3-6 词标题。

### 9. 会话状态 (`session/status.ts`)

内存级状态管理，通过 Bus 事件通知 UI 层：

- `idle` — 空闲
- `busy` — 代理循环执行中
- `retry` — 重试等待中

## 数据流

```text
POST message -> Prompt.prompt()
  -> Message.create(user)
  -> Prompt.loop()
    -> Message.list() // 加载历史
    -> buildToolSet() // 注册 + 权限过滤
    -> Processor.process()
      -> LLM.stream() -> streamText (AI SDK)
      -> 流事件 -> Part.create/update
      -> 工具调用 -> Permission.ask -> tool.execute
    -> finish=tool-calls ? 继续循环 : 退出
  -> SessionCompaction.prune()
  -> SessionSummary.summarize()
```

## 依赖

- **AI SDK** (`ai`, `@ai-sdk/*`): LLM 调用、流式处理、工具定义
- **Drizzle**: SQLite ORM，存储 session/message/part
- **Zod**: 运行时类型校验
- **Bus**: 内存事件总线，解耦模块通信
