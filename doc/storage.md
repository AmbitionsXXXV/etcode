# 持久化层

> SQLite 数据库持久化，使用 better-sqlite3 + Drizzle ORM。

## 概述

etcode 使用 SQLite 作为持久化存储，替代早期的 JSON 文件存储。数据库文件位于 `~/.local/share/etcode/etcode.db`。

## 数据库配置

- WAL 模式（Write-Ahead Logging）提高并发性能
- `synchronous = NORMAL` 平衡性能和安全
- `busy_timeout = 5000` 避免锁超时
- `cache_size = -64000` 约 64MB 缓存
- `foreign_keys = ON` 启用外键约束

## Schema

### SessionTable

| 列 | 类型 | 说明 |
|---|------|------|
| id | text PK | 会话 ID (sess_*) |
| project_id | text NOT NULL | 项目 ID |
| directory | text NOT NULL | 工作目录 |
| title | text NOT NULL | 会话标题 |
| agent | text | Agent 名称 |
| time_created | integer NOT NULL | 创建时间 |
| time_updated | integer NOT NULL | 更新时间 |

### MessageTable

| 列 | 类型 | 说明 |
|---|------|------|
| id | text PK | 消息 ID (msg_*) |
| session_id | text NOT NULL FK | 关联 session |
| time_created | integer NOT NULL | 创建时间 |
| time_updated | integer NOT NULL | 更新时间 |
| data | text (JSON) NOT NULL | 消息数据 |

`data` 字段存储结构化 JSON，包含：

- user: `{ role, content, time }`
- assistant: `{ role, finish, error, tokens, time }`

### PartTable

| 列 | 类型 | 说明 |
|---|------|------|
| id | text PK | Part ID (part_*) |
| message_id | text NOT NULL FK | 关联 message |
| session_id | text NOT NULL | 关联 session（冗余索引） |
| time_created | integer NOT NULL | 创建时间 |
| time_updated | integer NOT NULL | 更新时间 |
| data | text (JSON) NOT NULL | Part 数据 |

`data` 字段存储结构化 JSON，包含：

- text: `{ type: "text", text }`
- tool: `{ type: "tool", tool, callID, state: { status, input, output, error, title, time } }`

### TodoTable

| 列 | 类型 | 说明 |
|---|------|------|
| session_id | text NOT NULL FK | 关联 session |
| position | integer NOT NULL | 排序位置 |
| content | text NOT NULL | 内容 |
| status | text NOT NULL | 状态 |
| priority | text NOT NULL | 优先级 |

复合主键：`(session_id, position)`

## Migration

Migration 文件位于 `packages/etcode/migration/`，使用 Drizzle 标准格式：

```text
migration/
├── meta/
│   └── _journal.json
└── 20260227000000_init.sql
```

数据库初始化时自动应用 migration。

## Database API

```typescript
import { Database } from "../storage/db"

// 打开数据库（懒加载，首次调用时初始化）
Database.open()

// 执行查询
Database.use((db) => {
  const row = db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
  return row
})

// 事务
Database.transaction((tx) => {
  tx.insert(SessionTable).values({ ... }).run()
  tx.insert(MessageTable).values({ ... }).run()
})

// 关闭
Database.close()
```

## 文件结构

```text
src/storage/
├── db.ts           # Database 连接管理、migrate、use/transaction
├── schema.ts       # Schema 导出聚合
├── schema.sql.ts   # Timestamps 公共列定义
├── json.ts         # [废弃] JSON 文件存储
└── storage.ts      # [废弃] StorageDriver 接口
```

## 依赖

| 包 | 用途 |
|----|------|
| better-sqlite3 | SQLite3 原生绑定 |
| drizzle-orm | ORM / Query Builder |
