# Direct Chat Signal Architecture

## Context

单聊发现采用用户主动发送挑战文本的方案，不引入飞书用户授权，也不持久化任何单聊发现记录。daemon 已经是飞书事件和本地 MCP 调用之间的内存路由层，因此直接私聊信号也归 daemon runtime 管理。

## Boundaries

- `src/daemon/runtime.js` 负责绑定、消息队列、去重、等待者和直接私聊信号缓冲。
- `src/daemon/http-server.js` 只把本地 HTTP 请求转换为 runtime 调用，并把 runtime 错误映射成 HTTP 错误。
- `src/mcp/server.js` 只暴露工具 schema 和转发工具调用，不保存聊天或会话状态。
- 插件技能和 README 负责指导 agent 使用挑战文本流程，不承担状态管理。

## State Lifecycle

- 未绑定 P2P 消息进入短期内存缓冲，最多保留 5 分钟或 50 条。
- 同一飞书消息 ID 只能产生一个可消费的直接私聊信号。
- `lark_connect_wait_direct_chat_signal` 先匹配缓冲，再按 `timeoutMs` 注册等待者。
- 等待超时返回 `signal: null`，不自动绑定。
- 使用 `replace: true` 绑定新聊天时，旧绑定、旧消息队列、旧消息等待者、直接私聊信号等待者和未绑定 P2P 缓冲一起清空。

## Consequences

- 直接私聊发现保持无持久化、无用户授权的简单模型。
- 用户发送挑战文本过快仍可被短期缓冲捕获。
- 替换绑定是一次明确的本地状态重置，避免旧会话的长等待在新绑定后继续收消息。
