# Validation Contract — Lark Daemon Session Binding (验收契约 — 飞书守护进程会话绑定)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 守护进程生命周期 | VAL-DAEM-001 ~ VAL-DAEM-005 |
| 会话绑定 | VAL-BIND-001 ~ VAL-BIND-004 |
| 消息消费 | VAL-MSG-001 ~ VAL-MSG-006 |
| 一次性监听定位 | VAL-CLI-001 |

## Toolchain (本仓库验证栈)

> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test` |
| `integration-test` | `node:test`，必要时配合 `node:child_process` 启动 CLI 子进程 |
| `e2e-cli` | `node:test` 通过 CLI 子进程黑盒验证 |
| `manual` | 真实飞书测试群和本地命令行手动验证 |

## Assertions (断言)

### VAL-DAEM-001
- **Behavior (行为)**: MCP 工具在守护进程不在线时不得自动启动守护进程。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 调用任意依赖守护进程的 MCP 工具时返回 `DAEMON_NOT_RUNNING`，且系统中没有新增守护进程。

### VAL-DAEM-002
- **Behavior (行为)**: 守护进程不在线错误必须包含面向 Agent 的启动命令提示。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 错误响应包含 `code: "DAEMON_NOT_RUNNING"`，并包含可执行命令 `curiosea-lark-connect daemon start`。

### VAL-DAEM-003
- **Behavior (行为)**: 守护进程在 1 小时没有飞书事件或本地调用后必须自动退出。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 使用可控时钟或可配置超时触发空闲条件后，守护进程断开飞书连接并结束进程。

### VAL-DAEM-004
- **Behavior (行为)**: 收到飞书事件必须刷新守护进程空闲时间，即使事件最终没有匹配绑定。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 注入未绑定群消息后，守护进程的空闲倒计时重新开始。

### VAL-DAEM-005
- **Behavior (行为)**: 收到本地 MCP/CLI 调用必须刷新守护进程空闲时间。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 调用绑定、轮询、等待、确认或状态类接口后，守护进程的空闲倒计时重新开始。

### VAL-BIND-001
- **Behavior (行为)**: 绑定请求必须把一个飞书群绑定到一个明确的 Agent 会话。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 成功绑定后，状态查询能看到 `chat_id`、`agent_kind`、`agent_session_id` 和 `workspace`。

### VAL-BIND-002
- **Behavior (行为)**: 同一个飞书群已有活跃绑定时，未显式替换的新绑定必须失败。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 第二次绑定同一 `chat_id` 且未传替换标记时返回绑定冲突错误，原绑定保持不变。

### VAL-BIND-003
- **Behavior (行为)**: 显式替换绑定必须让新 Agent 会话成为该群唯一活跃绑定。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 替换后状态查询只显示新绑定，旧会话不再接收该群后续消息。

### VAL-BIND-004
- **Behavior (行为)**: 替换绑定时旧会话的未确认消息必须被丢弃。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 替换后用旧 `agent_session_id` 轮询消息返回空结果或未绑定错误。

### VAL-MSG-001
- **Behavior (行为)**: 已绑定群里的机器人提及消息必须进入对应 Agent 会话队列。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 注入带 `mentionedBot: true` 的目标群消息后，对应 `agent_session_id` 可以领取到该消息。

### VAL-MSG-002
- **Behavior (行为)**: 未绑定群里的机器人提及消息不得投递给任何 Agent 会话。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 注入未绑定 `chat_id` 的消息后，所有现有会话轮询结果都不包含该消息。

### VAL-MSG-003
- **Behavior (行为)**: Agent 领取消息后，消息在确认前不得被视为已消费。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 同一消息被领取后未确认时，状态查询显示它仍处于已投递未确认状态。

### VAL-MSG-004
- **Behavior (行为)**: Agent 显式确认消息后，该消息才算已消费。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 调用确认接口后，后续轮询不再返回该消息，状态查询显示已确认或不再列为待处理。

### VAL-MSG-005
- **Behavior (行为)**: 立即轮询没有消息时必须返回空结果，不得报错。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 对空队列调用轮询接口返回空列表或等价空结果，退出码和响应状态表示成功。

### VAL-MSG-006
- **Behavior (行为)**: 限时等待没有消息时必须以空结果或超时状态结束，不得把超时当作系统错误。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 在指定等待时间内无消息时，请求结束并返回可区分的空结果或超时结果。

### VAL-CLI-001
- **Behavior (行为)**: `listen --once` 保持为一次性调试命令，不依赖守护进程绑定。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 不启动守护进程时运行 `listen --once` 仍走直接监听路径；收到目标群 mention 后输出归一化消息并退出。
