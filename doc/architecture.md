# etcode 架构文档

## 概述

etcode 是一个 AI 驱动的 CLI Code Agent，采用 monorepo 结构组织代码。

## 技术栈

- **Runtime**: Node.js (via tsx)
- **Language**: TypeScript (ESM)
- **Monorepo**: pnpm workspaces + Turborepo
- **CLI**: yargs
- **Schema**: zod
- **ID**: 自定义 base62 + timestamp（递增/递减）
- **Storage**: JSON 文件系统

## 包结构

```text
etcode/
├── packages/
│   ├── util/          # @etcode/util 通用工具包
│   └── etcode/        # 核心 CLI 包
└── doc/               # 文档
```

## @etcode/util

通用工具包，零业务依赖：

- `error.ts` — `NamedError` 基类，支持 Zod schema 驱动的类型安全错误
- `lazy.ts` — 惰性求值，支持 `reset()`
- `identifier.ts` — 基于时间戳的单调递增/递减 ID 生成器

## packages/etcode 模块划分

### cli/

CLI 入口层，负责命令解析和启动引导。

- `cmd/cmd.ts` — `cmd()` 工厂函数，封装 yargs `CommandModule`
- `cmd/run.ts` — 默认 `run` 命令，启动 agent 交互会话
- `bootstrap.ts` — 项目初始化引导（Global init + Instance provide）
- `ui.ts` — 终端 UI 工具（logo、颜色、分隔线）

### session/

三层会话管理架构：

- `session.ts` — Session CRUD，包含 Zod schema 和事件发布
- `message.ts` — Message 管理，区分 user/assistant 角色（discriminated union）
- `part.ts` — Part 管理，区分 text/tool 类型（discriminated union）

### bus/

类型安全的发布-订阅事件总线：

- `bus-event.ts` — `BusEvent.define()` 事件定义工厂
- `index.ts` — `Bus.publish()` / `Bus.subscribe()` / `Bus.once()`

### storage/

可替换的存储层抽象：

- `storage.ts` — `StorageDriver` 接口（read/write/update/remove/list）
- `json.ts` — JSON 文件存储实现

### config/

配置管理，支持多层级合并：

- `config.ts` — 从全局和项目目录加载配置

### project/

项目上下文管理：

- `project.ts` — 项目信息检测（git root、directory）
- `instance.ts` — AsyncLocalStorage 驱动的项目实例上下文

### util/

内部工具：

- `context.ts` — AsyncLocalStorage 封装
- `log.ts` — 结构化 JSON 日志
- `filesystem.ts` — 文件系统操作工具

## 数据流

```text
CLI (yargs)
  → bootstrap (Global.init + Instance.provide)
    → Session.create
      → Storage.write (JSON 文件)
      → Bus.publish (session.created)
    → Message.create
      → Storage.write
      → Bus.publish (message.created)
    → Agent Loop (待实现)
      → Part.create
        → Bus.publish (part.updated)
```

## 存储路径

```text
~/.local/share/etcode/
├── storage/
│   └── {projectID}/
│       ├── session/{sessionID}.json
│       ├── message/{sessionID}/{messageID}.json
│       └── part/{messageID}/{partID}.json
└── log/
    └── etcode.log
```
