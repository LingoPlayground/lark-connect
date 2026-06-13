# Lark Download Resource — Spec (飞书资源下载工具 — 规范)

> 为已绑定的 agent session 提供入站资源下载 MCP 工具，让 agent 可以读取群里用户发来的图片或文件。

## Why (为什么做)

当前链路已经能接收真实 @ 机器人消息，也能把文本和本地文件发回群里。移动端验收场景里，设计师和产品经理经常会把截图、标注图或日志文件作为反馈附件发到群里；如果 agent 只能看到资源元数据而不能下载内容，就仍然需要人类手动转存附件。

第一版只下载已经进入当前 agent session 消息队列的资源，目标是打通“群里发附件给 agent 分析”的主路径，同时避免让本地工具变成任意飞书资源下载器。

## Findings (调研发现)

- [src/lark/listener.js](src/lark/listener.js) 会把 `message.resources` 归一化进消息 payload。
- [src/daemon/runtime.js](src/daemon/runtime.js) 会把已路由消息的 payload 保存在内存 session 队列里，状态即使 acknowledged 后仍可在 snapshot 中看到。
- [node_modules/@larksuiteoapi/node-sdk/types/index.d.ts](node_modules/@larksuiteoapi/node-sdk/types/index.d.ts) 暴露 `im.v1.messageResource.get`，可以通过 `message_id`、`file_key` 和资源 `type` 下载消息中的资源文件。
- [docs/research/lark-agent-bridge.md](docs/research/lark-agent-bridge.md) 已记录 `lark-cli im +messages-resources-download` 能下载消息中的图片和文件资源。
- 无项目专属 spec 规则；`docs/rules/spec/` 当前不存在。

## What (做什么)

新增一个 MCP 工具 `lark_connect_download_resource`。调用方必须传入当前 Codex thread 或 Claude Code session 的 `agentSessionId`、已收到消息的 `messageId` 和资源的 `fileKey`。

工具只允许下载该 session 已路由消息 payload 中存在的资源。未绑定 session 返回 `SESSION_NOT_BOUND`；消息不存在返回 `MESSAGE_NOT_FOUND`；资源不存在返回资源未找到错误。

第一版只支持下载飞书资源类型 `image` 和 `file`。成功时，工具把资源写入本地文件，并返回本地路径、最终文件名、资源类型、资源 key 和来源消息标识。

工具默认把资源下载到系统临时目录下的受控目录。调用方可以显式传入 `outputDir`，用于把资源放到当前工作区或其它人工指定目录；无论目录来源如何，最终文件名都不能允许路径穿越。

## Out of scope (本次不做)

- 不下载没有进入当前 session 消息队列的任意飞书资源。
- 不支持音频、视频、表情等非 `image` / `file` 类型。
- 不做批量下载、通配符下载或资源自动清理。
- 不新增持久化索引、下载历史或缓存。
- 不在下载后自动把文件喂给模型；后续 skill 可以定义如何使用下载产物。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- 飞书测试群和真实发送验证来自本会话；真实资源下载烟雾测试确认 `message_id + file_key + type=file` 可以下载测试群消息中的文件。
