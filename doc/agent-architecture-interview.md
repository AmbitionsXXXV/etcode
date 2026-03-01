# 求职面试：Agent 系统架构描述

## 一、架构概述（30 秒电梯演讲）

> 我设计并实现了一个完整的 LLM Agent 系统，核心是 **递归代理循环 + 工具编排 + 权限网关** 三层架构。系统支持多代理协作（主代理派发子代理并行执行任务）、自动上下文压缩处理长对话、流式处理保证实时响应，以及细粒度的权限控制确保安全性。

## 二、架构层次描述

### 第一层：递归代理循环（Agent Loop）

**面试话术：**

这是系统的核心引擎。每次用户发送消息后，进入一个 while 循环：

1. 加载历史消息，检查是否有未完成的工具调用或压缩任务
2. 构建 system prompt（基础提示 + 环境信息 + 项目指令文件）
3. 调用 LLM 获取流式响应
4. 解析流事件：文本增量实时推送给前端，工具调用则执行后将结果反馈给模型
5. 如果模型返回 `finish_reason=tool_calls`，继续循环；如果是 `stop`，退出

**技术亮点：**

- 使用 AbortController 实现取消传播，父会话取消时子代理也会联动取消
- 每步通过 git snapshot 记录文件变更，支持回滚
- 流式处理中维护了精确的状态机：pending -> running -> completed/failed

### 第二层：工具编排（Tool Orchestration）

**面试话术：**

工具系统采用注册-发现-执行模式：

- 工具通过 `Tool.define(id, init)` 注册，init 函数接收 agent 上下文，返回 description/parameters/execute
- 运行时根据模型能力动态选择工具集（例如 GPT 使用 apply_patch，Claude 使用 edit/write）
- 权限系统过滤掉被 deny 的工具
- 执行时自动处理参数校验、输出截断、权限检查

**子代理是特殊工具：** `TaskTool` 在执行时创建独立子会话，递归调用 `Prompt.prompt()` 运行完整的代理循环，实现了代理的递归组合。

### 第三层：权限网关（Permission Gateway）

**面试话术：**

权限系统采用 last-match-wins 的规则评估策略：

- 每个 Agent 携带一组权限规则（Ruleset）
- 工具执行前调用 `ctx.ask()` 发起权限检查
- 三种动作：allow（静默放行）、deny（静默拒绝）、ask（暂停等待用户确认）
- `ask` 模式通过事件总线 publish/subscribe 实现异步等待，不阻塞主线程
- 支持 `always` 模式：用户一次批准后，相同权限的后续请求自动放行

## 三、核心功能实现

### 1. 上下文压缩（Compaction）

**问题：** 长对话导致 token 超过模型上下文窗口限制。

**方案：**

- 每步结束后检测 `tokens.input + tokens.output` 是否接近上下文上限
- 触发压缩时，使用专用 compaction agent 调用 LLM 生成结构化摘要
- 摘要消息标记 `summary=true`，后续构建 model messages 时遇到 summary 消息会重置上下文（只保留摘要及之后的消息）
- 额外的 prune 机制：回溯裁剪旧工具输出（保留最近 40K token），在不触发全量压缩的情况下渐进释放空间

**技术选型：** 使用 LLM 自身做压缩（而非截断），因为模型能理解哪些信息对后续任务更重要。

### 2. 子代理执行（Subagent）

**问题：** 复杂任务需要分解为独立子任务并行执行。

**方案：**

- 子代理通过 TaskTool 触发，创建独立的数据库会话
- 递归调用 `Prompt.prompt()` 执行完整的代理循环
- 通过 AbortController 事件监听实现父子取消联动
- finally 块确保即使异常也能清理监听器
- 子代理结果提取最后的 text part 返回给父会话

### 3. 流式处理状态一致性

**问题：** LLM 流式返回中，工具调用、文本、错误交错出现，需要正确维护数据库状态。

**方案：**

- Processor 维护一个 `toolcalls` map 记录进行中的工具调用
- `tool-call` 事件创建 pending part -> `tool-result` 事件更新为 completed
- 流异常中断时，将所有未完成的 tool call 标记为 failed
- 使用指数退避重试处理 rate limit（429）、overload（503）、timeout
- 文本增量通过 Bus 事件实时推送到 UI 层

### 4. 标题生成（Title Generation）

**问题：** 会话默认标题是 "New Session"，用户难以区分。

**方案：**

- 在代理循环的第一步异步触发（不阻塞主流程）
- 使用 title agent 以低温度（0.5）生成简洁标题
- fire-and-forget 模式，失败只记日志不影响主流程

## 四、难点与解决方案

### 难点 1：循环依赖

**问题：** `prompt.ts` 导出 `toModelMessages` 被 `compaction.ts` 引用，而 `prompt.ts` 又引用 `compaction.ts`。`task.ts` 也需要引用 `prompt.ts`。

**解决：** 通过动态 `import()` 打破循环。`task.ts` 中对 `Prompt` 的引用使用 `await import('../session/prompt')` 延迟加载。`compaction.ts` 只引用 `prompt.ts` 中的纯函数 `toModelMessages`，避免引用 namespace。

### 难点 2：子代理生命周期管理

**问题：** 父会话取消时，子代理的 LLM 流必须同步终止，否则造成资源泄漏和幽灵执行。

**解决：**

- 子代理执行前注册 `abort` 事件监听器
- 监听器调用 `cancel(childSessionID)` 终止子会话的 AbortController
- 使用 `try/finally` 确保监听器在任何退出路径上都被清理
- 每个会话的 AbortController 在 start 时先 cancel 已有的（防止重入）

### 难点 3：上下文压缩时的消息连贯性

**问题：** 压缩后模型看到的是摘要，但可能缺少必要的对话格式（如缺少 user 消息导致某些模型报错）。

**解决：**

- 压缩完成后自动插入一条 synthetic user 消息："Continue if you have next steps..."
- `toModelMessages` 遇到 `summary=true` 的 assistant 消息时，清空之前的所有消息，只保留摘要作为新的起点
- 这确保了模型始终看到格式正确的 user/assistant 交替结构

### 难点 4：Permission 的异步等待不阻塞

**问题：** `ask` 模式需要暂停工具执行等待用户确认，但不能阻塞 Node.js 事件循环。

**解决：**

- `Permission.ask()` 返回一个 Promise
- 通过闭包捕获 `resolve`/`reject`
- 用户通过 `Permission.reply()` 触发 resolve/reject
- 支持 `always` 模式：将规则追加到运行时 approved 列表，并级联解锁同 session 的其他待处理请求

## 五、总结性话术

> 整个系统的设计思路是 **让 LLM 成为决策核心，工具成为执行手段，权限成为安全边界**。通过递归循环实现了代理的自主决策能力，通过子代理实现了任务分解和并行执行，通过上下文压缩解决了长对话的 token 限制问题。这不是一个简单的 API 调用封装，而是一个具备自治能力的代理运行时。

## 六、关键指标

| 指标 | 描述 |
|------|------|
| 内置工具 | 15+ 个（read、edit、write、bash、grep、glob、task 等） |
| 内置代理 | 7 个（build、plan、general、explore、compaction、title、summary） |
| 权限规则 | 支持通配符匹配、三级动作、last-match-wins 评估 |
| 重试策略 | 指数退避，最多 5 次，最大延迟 30 秒 |
| 上下文管理 | 自动压缩 + 渐进 prune 双重策略 |
| 流式处理 | 实时文本推送、工具状态追踪、异常回滚 |
