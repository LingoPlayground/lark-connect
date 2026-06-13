# Lark Send File — Spec (飞书文件发送工具 — 规范)

> 为已绑定的 agent session 提供本地文件发送 MCP 工具，让 agent 可以把截图、录屏、日志或构建产物发回飞书群。

## Why (为什么做)

文本发送已经能让 agent 回传状态和短消息，但移动端界面验收场景里，最常见的产物是截图、录屏和日志文件。没有文件发送能力时，agent 仍需要人类手动把本地产物转发到飞书群，闭环不完整。

第一版只支持本地单文件发送，并沿用当前 session 绑定群，目的是先覆盖“把当前工作产物发给群里验收”的主路径。

## Findings (调研发现)

- [docs/research/lark-agent-bridge.md](docs/research/lark-agent-bridge.md) 记录了 `lark-cli im +messages-send` 支持本地文件、图片、视频和音频。
- [node_modules/@larksuiteoapi/node-sdk/types/index.d.ts](node_modules/@larksuiteoapi/node-sdk/types/index.d.ts) 暴露 `LarkChannel.send(to, input, opts)`，其中 `input` 支持 `{ file: { source, fileName } }`，`opts` 支持 `replyTo` 和 `replyInThread`。
- [README.md](README.md) 实现前只记录了文本发送工具，还没有文件发送或单独添加 reaction 的工具。
- 无项目专属 spec 规则；`docs/rules/spec/` 当前不存在。

## What (做什么)

新增一个 MCP 工具 `lark_connect_send_file`。调用方必须传入当前 Codex thread 或 Claude Code session 的 `agentSessionId` 和本地 `filePath`。

工具只向该 session 当前绑定的飞书群发送文件。未绑定时必须返回与现有收取和发送工具一致的 `SESSION_NOT_BOUND` 错误，并提示先调用绑定工具。

工具支持可选 `fileName`，用于覆盖飞书里显示的文件名。工具支持可选 `replyToMessageId` 和 `replyInThread`，用于把文件作为对原消息的回复。

成功响应必须包含飞书返回的新消息标识、绑定群标识、发送的本地文件路径和最终文件名，方便后续工具或人工追踪。

## Out of scope (本次不做)

- 不支持远程 URL、目录批量发送或通配符展开。
- 不区分图片、视频、音频的专用消息类型；第一版统一按文件发送。
- 不下载用户发来的附件；下载属于入站资源工具。
- 不提供单独添加 reaction 的 MCP 工具；`ack` 默认加 `OK` reaction 的行为保持不变。
- 不新增持久化配置或发送历史。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- 飞书测试群和真实发送验证来自本会话，确认当前绑定、文本发送、文件发送和回复路径已可用。
