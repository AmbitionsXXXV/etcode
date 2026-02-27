# TUI 实现

> 基于 Ink (React for CLI) 的终端用户界面。

## 概述

etcode TUI 提供交互式终端界面，支持实时对话、流式文本输出和工具调用展示。

## 启动方式

```bash
# 默认命令 —— 在当前目录启动 TUI
etcode .

# 指定项目目录
etcode /path/to/project

# 继续上一个 session
etcode --continue

# 指定 session
etcode --session <id>

# 指定 agent
etcode --agent build

# 带初始 prompt
etcode --prompt "fix the bug"
```

## 架构

```text
CLI (index.ts)
  ↓ $0 [project]
TuiCommand (tui-cmd.ts)
  ↓ bootstrap + chdir
App (tui/app.tsx)
  ├─ Header      (session/agent/model 信息)
  ├─ Messages    (消息列表)
  │   ├─ UserMessage
  │   └─ AssistantMessage
  │       ├─ TextPart (流式文本)
  │       └─ ToolPart (工具调用状态)
  ├─ PromptInput (文本输入)
  └─ Footer      (快捷键提示)
```

TUI 直接调用 Session/Prompt API（同进程），通过 Bus 事件驱动 UI 更新，不经过 HTTP Server。

## 数据流

```text
用户输入 → PromptInput.onSubmit()
  → Prompt.prompt() → Agent Loop
    → Bus.publish(Part.Event.Delta)    → Messages 更新文本
    → Bus.publish(Part.Event.Updated)  → Messages 更新工具状态
    → Bus.publish(Session.Event.Error) → 显示错误
```

## 组件

### Header (`components/header.tsx`)

显示项目名称、session 标题、agent 名称和 model 信息。使用 Ink `Box` 和 `Text` 的 border 样式。

### Messages (`components/messages.tsx`)

消息列表，包含 UserMessage 和 AssistantMessage 子组件。

- UserMessage: 蓝色 `>` 前缀 + 用户文本
- AssistantMessage: TextPart 流式文本 + ToolPart 工具状态

### PromptInput (`components/prompt.tsx`)

使用 `ink-text-input` 组件，loading 时禁用输入并显示等待提示。

### Footer (`components/footer.tsx`)

显示快捷键：

- `Ctrl+C` — 取消当前生成 / 退出
- `Ctrl+N` — 新建 session
- `Enter` — 发送消息

### Spinner (`components/spinner.tsx`)

Unicode braille 字符动画（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏），80ms 帧率。

### Tool (`components/tool.tsx`)

工具调用状态展示：

- pending/running: Spinner + 工具名
- completed: ✓ + 标题 + 耗时
- failed: ✗ + 工具名 + 错误信息

## 快捷键

| 按键 | 行为 |
|------|------|
| Enter | 发送消息 |
| Ctrl+C | loading 时取消生成，空闲时退出 |
| Ctrl+N | 新建 session |

## 状态管理

App 组件使用 React `useState` 管理全局状态：

- `session` — 当前 Session.Info
- `agent` — 当前 Agent.Info
- `model` — 当前 Provider.Model
- `messages` — 消息列表（包含 parts 和 streaming buffer）
- `loading` — 是否正在等待 LLM 响应
- `error` — 最近一次错误信息

Bus 事件通过 `useEffect` 订阅，更新对应状态。

## 文件结构

```text
src/cli/cmd/
├── tui-cmd.ts              # TUI 命令入口 ($0 [project])
└── tui/
    ├── app.tsx             # 根组件 + tui() 启动函数
    └── components/
        ├── header.tsx      # 顶部信息栏
        ├── messages.tsx    # 消息列表
        ├── prompt.tsx      # 输入框
        ├── footer.tsx      # 快捷键提示
        ├── spinner.tsx     # 加载动画
        └── tool.tsx        # 工具调用展示
```

## 依赖

| 包 | 用途 |
|----|------|
| ink | React for CLI terminals |
| ink-text-input | 文本输入组件 |
| react | React runtime |
