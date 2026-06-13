# Lark Send Message — Spec (飞书文本发送工具 — 规范)

> 为已绑定的 agent session 提供第一个出站 MCP 工具，让 agent 可以向当前飞书群发送文本或回复原消息。

## Why (为什么做)

当前核心链路已经能监听目标群里真实 @ 机器人的反馈，并在处理完成后用 `OK` reaction 确认收到。下一步需要让 agent 能主动把处理结果、简短状态或追问发回同一个飞书群，否则协作闭环仍然依赖本地对话里的人工转述。

第一版只做文本发送和原消息回复，目的是先打通最常用的沟通路径，同时避免把截图、录屏、文件上传、卡片和单独 reaction 都挤进同一个工具。

## Findings (调研发现)

- [docs/research/lark-agent-bridge.md](docs/research/lark-agent-bridge.md) 记录了 `lark-cli im +messages-send` 和 `lark-cli im +messages-reply` 已能验证文本发送和回复能力。
- [node_modules/@larksuiteoapi/node-sdk/types/index.d.ts](node_modules/@larksuiteoapi/node-sdk/types/index.d.ts) 暴露 `LarkChannel.send(to, input, opts)`，其中 `input` 支持 `{ text }`，`opts` 支持 `replyTo` 和 `replyInThread`。
- [README.md](README.md) 当前 MCP 工具只覆盖绑定、收取和确认，还没有提供发送文本、发送资源或单独添加 reaction 的工具。
- 无项目专属 spec 规则；`docs/rules/spec/` 当前不存在。

## What (做什么)

新增一个 MCP 工具 `lark_connect_send_message`。调用方必须传入当前 Codex thread 或 Claude Code session 的 `agentSessionId` 和非空 `text`。

工具只向该 session 当前绑定的飞书群发送消息。未绑定时必须返回与现有收取工具一致的 `SESSION_NOT_BOUND` 错误，并提示先调用绑定工具。

工具支持可选 `replyToMessageId`。提供该字段时，发送结果应是对指定飞书消息的回复；未提供时，发送结果应是普通群消息。工具也支持可选 `replyInThread`，用于让飞书在支持的场景中把回复放到线程内。

成功响应必须包含飞书返回的新消息标识，方便后续工具继续引用这条消息。

## Out of scope (本次不做)

- 不发送图片、文件、录屏、音频、视频或卡片；这些需要单独处理资源上传和安全边界。
- 不提供单独添加 reaction 的 MCP 工具；`ack` 默认加 `OK` reaction 的行为保持不变。
- 不支持跨群或指定任意 `chatId` 发送；第一版只允许发到当前 session 绑定的群。
- 不新增持久化配置或发送历史。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- 飞书测试群和真实 @ 机器人端到端验证来自本会话，确认当前绑定、收取和 `ack` reaction 已可用。
