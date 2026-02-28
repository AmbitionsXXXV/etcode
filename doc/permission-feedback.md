# 权限交互与结果反馈系统

## 概述

本文档描述 etcode 的两大核心子系统：

1. **权限交互系统（Permission Ask/Reply）** — 工具执行前的权限请求与用户审批流程
2. **结果反馈系统（Snapshot + Session Summary）** — 文件变更追踪与会话摘要

## 权限交互系统

### 架构

权限系统基于 **Promise 挂起 + 事件通知** 模式，实现工具执行前的人机交互审批。

核心路径：`packages/etcode/src/permission/permission.ts`

### 数据结构

```typescript
// 权限请求
Request = {
  id: string           // "perm_" 前缀 ID
  sessionID: string
  permission: string   // 权限名：bash, edit, read 等
  patterns: string[]   // 匹配模式，如文件路径
  metadata: Record<string, unknown>
  always: string[]     // "always" 回复时自动添加的允许模式
  tool?: { messageID: string; callID: string }
}

// 回复类型
Reply = "once" | "always" | "reject"

// 规则
Rule = { permission: string; pattern: string; action: "allow" | "deny" | "ask" }
Ruleset = Rule[]
```

### 事件

| 事件 | 触发时机 |
|------|---------|
| `permission.asked` | 权限需要用户审批时 |
| `permission.replied` | 用户回复权限请求后 |

### 流程

1. 工具调用 `ctx.ask({ permission, patterns, always, metadata })`
2. `Permission.ask()` 对每个 pattern 执行 `evaluate()`
3. 规则匹配结果：
   - `allow` — 直接放行
   - `deny` — 抛出 `DeniedError`
   - `ask` — 挂起 Promise，发布 `permission.asked` 事件
4. UI 订阅事件，展示审批界面
5. 用户选择后调用 `Permission.reply()`：
   - `once` — resolve Promise，本次放行
   - `always` — 将模式添加到 approved 规则集，resolve，并级联 resolve 同 session 中匹配的其他 pending 请求
   - `reject` — reject Promise，可附带反馈消息；同时 reject 同 session 所有其他 pending 请求

### 错误类型

| 错误 | 场景 |
|------|------|
| `RejectedError` | 用户拒绝，无反馈消息 |
| `CorrectedError` | 用户拒绝并附带修正建议 |
| `DeniedError` | 配置规则自动拒绝 |

### 规则评估

使用 `findLast` 语义——后添加的规则优先。支持 `*` 通配符前缀/后缀匹配。

评估顺序：`agent 内置规则` → `用户配置规则` → `运行时 approved 规则`

## Snapshot 快照系统

### 架构

使用独立 git 仓库追踪工作区文件变更，不干扰用户项目的 git 状态。

核心路径：`packages/etcode/src/snapshot/index.ts`

### 存储位置

```text
~/.local/share/etcode/snapshot/{projectID}/
```

### 核心 API

| 函数 | 说明 |
|------|------|
| `track()` | 对工作区创建快照，返回 tree hash |
| `diff(hash)` | 与指定快照比较，返回文本 diff |
| `diffFull(from, to)` | 结构化 diff，返回 `FileDiff[]` |
| `patchFiles(hash)` | 返回变更文件列表 |
| `restore(snapshot)` | 恢复到指定快照 |
| `revert(patches)` | 逐文件回退 |
| `cleanup()` | 清理过期快照（7 天） |

### FileDiff 结构

```typescript
FileDiff = {
  file: string
  before: string       // 变更前内容
  after: string        // 变更后内容
  additions: number    // 新增行数
  deletions: number    // 删除行数
  status: "added" | "deleted" | "modified"
}
```

### 初始化

首次 `track()` 时自动执行 `git init`，并同步项目 `.gitignore` 到 snapshot 仓库的 `info/exclude`。

## Session Summary 会话摘要

### 架构

在 agent loop 结束后自动计算文件变更摘要，写入数据库和 JSON 存储。

核心路径：`packages/etcode/src/session/summary.ts`

### Step Part 类型

Processor 在每次 LLM 调用前后记录快照 hash：

- `step-start` — 携带调用前的 snapshot hash
- `step-finish` — 携带调用后的 snapshot hash

Part 类型定义在 `packages/etcode/src/session/part.ts`。

### 摘要计算流程

1. Prompt loop 结束后调用 `SessionSummary.summarize()`
2. 收集所有 assistant message 的 parts
3. 提取最早的 `step-start` snapshot 和最晚的 `step-finish` snapshot
4. 调用 `Snapshot.diffFull(from, to)` 计算结构化 diff
5. 更新 Session 的 `summary_additions`、`summary_deletions`、`summary_files`
6. 写入 JSON 存储 `session_diff/{sessionID}`
7. 发布 `session.diff` 事件

### 数据库 Schema 变更

SessionTable 新增列：

| 列 | 类型 | 说明 |
|----|------|------|
| `summary_additions` | integer | 总新增行数 |
| `summary_deletions` | integer | 总删除行数 |
| `summary_files` | integer | 变更文件数 |

PermissionTable（新增表）：

| 列 | 类型 | 说明 |
|----|------|------|
| `project_id` | text (PK) | 项目 ID |
| `data` | text (JSON) | 已批准的 Ruleset |

迁移文件：`migration/20260228000000_permission_summary.sql`

## 文件清单

| 文件 | 说明 |
|------|------|
| `src/permission/permission.ts` | 权限规则评估 + ask/reply 交互流程 |
| `src/snapshot/index.ts` | Git 快照管理 |
| `src/session/summary.ts` | 会话变更摘要 |
| `src/session/session.ts` | Session CRUD + setSummary + Diff 事件 |
| `src/session/session.sql.ts` | 数据库 Schema |
| `src/session/part.ts` | Part 类型（含 step-start/step-finish） |
| `src/session/prompt.ts` | ctx.ask() 实现 + summarize 集成 |
| `src/session/processor.ts` | 流处理 + snapshot 追踪 |
| `src/storage/schema.ts` | Schema 导出 |
