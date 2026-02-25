# Session 管理系统设计

> 参考：[智能体核心模块 1 — 构建最小化 Session 管理系统](https://zhuanlan.zhihu.com/p/2006646366051537120)

## 概述

Session 管理系统采用三层数据架构：Session → Message → Part，通过 Zod discriminated union 实现类型安全的多态数据结构，配合 Bus 事件总线实现响应式更新。

## 三层数据模型

### Session

会话的顶层容器，记录项目关联和时间信息。

```typescript
{
  id: string,          // "sess_" 前缀的单调递增 ID
  title: string,       // 会话标题
  projectID: string,   // 所属项目
  directory: string,   // 工作目录
  time: {
    created: number,   // 创建时间戳
    updated: number,   // 最后更新时间戳
  }
}
```

### Message

会话中的消息，通过 `role` 字段区分用户和助手消息。

```typescript
// 用户消息
{ role: "user", id, sessionID, content, time }

// 助手消息
{ role: "assistant", id, sessionID, time }
```

使用 Zod `discriminatedUnion("role", [...])` 确保类型安全。

### Part

消息的组成部分，通过 `type` 字段区分文本和工具调用。

```typescript
// 文本 Part
{ type: "text", id, messageID, text }

// 工具 Part
{ type: "tool", id, messageID, tool, state: { status, input?, output?, error? } }
```

工具状态流转：`pending → running → completed | failed`

## 事件系统

每个数据层级的变更都会通过 Bus 发布事件：

| 事件 | 触发时机 |
|------|---------|
| `session.created` | Session 创建 |
| `session.updated` | Session 更新（touch / setTitle） |
| `session.deleted` | Session 删除 |
| `message.created` | Message 创建 |
| `message.deleted` | Message 删除 |
| `part.updated` | Part 创建或更新 |

## 存储策略

初始版本采用 JSON 文件存储，通过 `StorageDriver` 接口抽象，后续可平滑切换到 SQLite 等方案。

存储路径：

```text
~/.local/share/etcode/storage/{projectID}/
├── session/{sessionID}.json
├── message/{sessionID}/{messageID}.json
└── part/{messageID}/{partID}.json
```

## ID 生成

使用时间戳 hex + random base62 的组合，保证：

- 单调递增：按时间自然排序
- 唯一性：8 位 base62 随机后缀
- 可读性：带语义前缀（`sess_`、`msg_`、`part_`）

## 设计原则

1. **Zod Schema 驱动** — 所有数据结构用 Zod 定义，运行时校验
2. **Discriminated Union** — Message 和 Part 使用判别联合，类型推断友好
3. **Event-Driven** — 状态变更通过 Bus 广播，解耦消费者
4. **Storage 抽象** — 接口化存储层，支持后续替换
5. **最小化** — 初始版本只包含核心 CRUD，按需扩展
