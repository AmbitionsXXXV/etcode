# Agent 智能体系统设计

> 参考：[智能体核心模块 2 — 内置智能体系统](https://zhuanlan.zhihu.com/p/2007022050854868733)

## 概述

Agent 模块负责管理不同类型的 AI 代理，每个代理具有特定的权限配置和用途。系统预置 7 个内置 Agent，同时支持用户通过配置文件自定义 Agent。

## 架构

```text
Config（etcode.json）
  ↓
Permission.fromConfig → Permission.merge → Ruleset
  ↓
Agent.state()
  ├── 内置 Agent（build, plan, general, explore, compaction, title, summary）
  └── 用户自定义 Agent（来自 config.agent）
  ↓
Agent.get / Agent.list / Agent.defaultAgent
  ↓
SessionPrompt（未来接入 LLM 调用）
```

## Agent 类型定义

```typescript
Agent.Info = {
  name: string,
  description?: string,
  mode: "primary" | "subagent" | "all",
  hidden?: boolean,
  temperature?: number,
  topP?: number,
  permission: Permission.Ruleset,
  model?: { providerID: string, modelID: string },
  prompt?: string,
  steps?: number,
}
```

- `mode` 决定 Agent 的使用方式：
  - `primary` — 主 Agent，可直接选择使用
  - `subagent` — 子 Agent，通过 Task 工具调用
  - `all` — 两者皆可

## 内置 Agent 列表

| Agent | Mode | Hidden | 说明 |
|-------|------|--------|------|
| build | primary | - | 默认执行 Agent，拥有完整权限 |
| plan | primary | - | 规划模式，禁用编辑工具 |
| general | subagent | - | 通用任务子 Agent |
| explore | subagent | - | 只读代码探索 Agent |
| compaction | primary | yes | 上下文压缩（内部） |
| title | primary | yes | 会话标题生成（内部） |
| summary | primary | yes | 会话摘要生成（内部） |

### build Agent

默认执行 Agent，代码生成主力。

- 拥有完整权限（read/write/edit/exec）
- 用户未指定 Agent 时的默认选择
- 可调用 `plan_enter` 切换到规划模式

### plan Agent

规划专用 Agent，用于制定复杂任务的实施计划。

- 禁用大部分编辑权限
- 仅允许写入 `.etcode/plans/*.md` 规划文件
- 通过 `plan_exit` 工具切换回 build

### general Agent

通用任务子 Agent，用于并行执行多个独立任务。

- 作为子 Agent 使用（通过 Task 工具调用）
- 禁用 todo 相关工具

### explore Agent

代码探索子 Agent，专门用于快速查找和分析代码库。

- 仅允许只读操作（grep, glob, read, bash, websearch）
- 禁止写入/编辑/执行

### compaction / title / summary Agent

隐藏的内部 Agent，分别用于上下文压缩、标题生成和摘要生成，禁用所有工具。

## 权限系统

### Permission.Rule

```typescript
{
  permission: string,  // 权限名称，支持通配符 *
  pattern: string,     // 匹配模式，支持通配符 *
  action: "allow" | "deny" | "ask",
}
```

### 三层权限合并

```text
defaults（系统默认）→ Agent 特定权限 → user（用户配置）
```

后者覆盖前者。使用 `Permission.merge()` 合并多层规则，评估时取最后匹配的规则。

### 默认权限

```typescript
{
  "*": "allow",
  "doom_loop": "ask",
  "plan_enter": "deny",
  "plan_exit": "deny",
  "read": {
    "*": "allow",
    "*.env": "ask",
    "*.env.*": "ask",
  },
}
```

## 配置

通过 `etcode.json` 配置 Agent：

```json
{
  "default_agent": "build",
  "agent": {
    "build": {
      "model": "gpt-4o",
      "temperature": 0.7
    },
    "my-agent": {
      "description": "Custom research agent",
      "mode": "subagent",
      "prompt": "You are a research assistant...",
      "permission": {
        "*": "deny",
        "read": "allow",
        "websearch": "allow"
      }
    }
  },
  "permission": {
    "bash": "ask"
  }
}
```

### 配置项说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `default_agent` | string | 默认 Agent 名称 |
| `agent` | Record | Agent 配置映射 |
| `agent.*.model` | string | 模型标识 |
| `agent.*.prompt` | string | 系统提示词 |
| `agent.*.description` | string | Agent 描述 |
| `agent.*.temperature` | number | 采样温度 |
| `agent.*.top_p` | number | Top-P 采样 |
| `agent.*.mode` | string | primary / subagent / all |
| `agent.*.hidden` | boolean | 是否隐藏 |
| `agent.*.permission` | Record | 权限配置 |
| `agent.*.steps` | number | 最大迭代步数 |
| `agent.*.disable` | boolean | 禁用此 Agent |
| `permission` | Record | 全局权限配置 |

## CLI 使用

```bash
# 使用默认 Agent（build）
etcode run "implement feature X"

# 指定 Agent
etcode run --agent plan "design the auth system"
etcode run -a explore "find all API endpoints"
```

## Session 关联

Session 创建时记录使用的 Agent：

```typescript
Session.Info = {
  // ...
  agent: string,  // Agent 名称
  // ...
}
```

## API

```typescript
// 获取指定 Agent
const agent = await Agent.get("build")

// 列出所有 Agent（默认 Agent 排在首位）
const agents = await Agent.list()

// 获取默认 Agent 名称
const name = await Agent.defaultAgent()
```

## 设计亮点

| 特性 | 优势 |
|------|------|
| 三层权限合并 | 灵活配置，可覆盖 |
| 主/子 Agent 分离 | 职责清晰，协作灵活 |
| 规划与执行分离 | 复杂任务有序处理 |
| 用户自定义 Agent | 扩展性强 |
| 通配符匹配 | 权限规则简洁有力 |
