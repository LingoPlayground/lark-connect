# CLI App Setup — Spec (CLI 应用配置 — 规范)

> 调整命令行配置模型：`setup` 只配置飞书应用凭据，群聊仍由 MCP 绑定工具指定。

## Why (为什么做)

当前命令行仍保留原型期的 `setup-url` 和一次性参数形态，用户容易误以为飞书后台链接可以完成配置。实际后台链接只能帮助找到应用信息，不能替代 `appId` 和 `appSecret`。

插件化后，非开发同事或 agent 需要一个稳定的一次性 setup 入口，把应用级凭据保存到本地；运行时再由 MCP 工具把具体群聊绑定到具体 agent 会话。这样可以避免把群聊当成全局配置，也避免每次启动守护进程都重复传密钥。

## Findings (调研发现)

- [src/cli.js](src/cli.js) 当前暴露 `setup-url`、`doctor`、`listen --once`、`daemon` 和 `mcp`。
- [src/config.js](src/config.js) 当前只从命令行显式参数和环境变量解析 `appId`、`appSecret`、`chatId`。
- [docs/guides/agent-mcp-setup.md](docs/guides/agent-mcp-setup.md) 当前说明仍要求先用飞书凭据启动守护进程。
- 用户已明确：`setup` 不应该接收 `chatId`，群聊是绑定工具的参数。

## What (做什么)

### 1. Setup 命令

`curiosea-lark-connect setup` 不带参数时输出飞书应用配置引导，告诉用户去哪里找到应用 ID 和应用密钥，以及如何执行带参数的 setup。

`curiosea-lark-connect setup --app-id cli_xxx --app-secret <secret>` 保存应用级配置。该命令不接受 `--chat-id` 作为配置输入；群聊仍由 MCP 绑定时传入。

### 2. Config 命令

命令行提供查看配置状态、查看配置文件路径、清除配置的入口。展示配置时不得泄露完整应用密钥，只展示是否已配置。

### 3. 配置读取优先级

运行时配置按“显式命令行参数、环境变量、本地配置、默认值”的顺序解析。环境变量和命令行参数保留为调试或临时覆盖手段。

### 4. Doctor 与 Daemon

`doctor` 和 `daemon start` 默认可以从本地配置读取应用凭据。`doctor --live` 继续表示真实调用飞书接口做连通性检查。

### 5. Listen 调试入口

一次性监听保留为调试能力，但主帮助里应表达为调试入口。正式 agent 消息消费路径仍是本地守护进程加 MCP 绑定、轮询、确认。

## Out of scope (本次不做)

- 不把群聊 ID 写入全局配置。
- 不接入系统钥匙串。
- 不自动创建或配置飞书应用。
- 不让 MCP 工具自动启动守护进程。
- 不移除 `lark_connect_bind_session` 的 `chatId` 参数。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

无。
