# Validation Contract — Lark Send Message (验收契约 — 飞书文本发送工具)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| MCP 工具暴露与转发 | VAL-SEND-001 |
| 绑定群发送与回复 | VAL-SEND-002 |
| 未绑定错误 | VAL-SEND-003 |

## Toolchain (本仓库验证栈)

> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test`，通过 `npm test -- <test file>` 运行 |
| `integration-test` | `node:test` + 本地 HTTP daemon/client 测试 |
| `manual` | 真实飞书测试群 + `lark-cli`/MCP JSON-RPC 烟雾验证 |

## Assertions (断言)

### VAL-SEND-001
- **Behavior (行为)**: MCP 工具列表包含 `lark_connect_send_message`，且调用时会把 `agentSessionId`、`text`、`replyToMessageId` 和 `replyInThread` 传给本地 daemon。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: MCP 测试能观察到工具列表包含该工具，工具调用返回新飞书消息标识。

### VAL-SEND-002
- **Behavior (行为)**: 已绑定 session 调用发送工具时，消息只发送到该 session 绑定的飞书群；提供 `replyToMessageId` 时发送结果是对该消息的回复。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 本地 daemon 测试注入出站客户端后，能观察到目标 `chatId`、文本内容和回复参数，并返回新消息标识。

### VAL-SEND-003
- **Behavior (行为)**: 未绑定 session 调用发送工具时不触发飞书发送，并返回 `SESSION_NOT_BOUND` 错误。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 本地 daemon 测试中未绑定 session 的发送请求返回 404 和 `SESSION_NOT_BOUND`，出站客户端没有调用记录。
