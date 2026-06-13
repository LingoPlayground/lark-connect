# Validation Contract — Lark Download Resource (验收契约 — 飞书资源下载工具)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| MCP 工具暴露与转发 | VAL-RES-001 |
| 已绑定消息资源下载 | VAL-RES-002 |
| 未绑定、消息缺失和资源缺失错误 | VAL-RES-003 |
| 本地文件落盘安全 | VAL-RES-004 |

## Toolchain (本仓库验证栈)

> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test`，通过 `npm test -- <test file>` 运行 |
| `integration-test` | `node:test` + 本地 HTTP daemon/client 测试 |
| `manual` | 真实飞书测试群 + MCP JSON-RPC 烟雾验证 |

## Assertions (断言)

### VAL-RES-001
- **Behavior (行为)**: MCP 工具列表包含 `lark_connect_download_resource`，且调用时会把 `agentSessionId`、`messageId`、`fileKey` 和 `outputDir` 传给本地 daemon。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: MCP 测试能观察到工具列表包含该工具，工具调用返回本地下载文件路径。

### VAL-RES-002
- **Behavior (行为)**: 已绑定 session 调用下载工具时，只能下载该 session 已收到消息 payload 中存在的 `image` 或 `file` 资源，并把内容写入本地文件。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 本地 daemon 测试注入资源下载客户端后，能观察到目标资源 key、资源类型和输出目录，并返回本地文件路径、文件名、来源消息和资源元数据。

### VAL-RES-003
- **Behavior (行为)**: 未绑定 session、消息不存在或资源不存在时，下载工具不触发飞书下载，并返回明确错误。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 本地 daemon 测试中这些错误路径分别返回 `SESSION_NOT_BOUND`、`MESSAGE_NOT_FOUND` 或资源未找到错误，资源客户端没有调用记录。

### VAL-RES-004
- **Behavior (行为)**: 下载文件名来自资源元数据时不能造成路径穿越；没有可用文件名时必须使用安全兜底文件名。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 资源客户端测试中带路径片段的文件名只会落在目标目录内，返回的文件名不包含目录分隔符。
