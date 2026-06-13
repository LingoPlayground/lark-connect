# Lark Agent Bridge Research

## 背景

目标是做一个 Codex 插件，其中包含一个核心 MCP 服务，让本地 Codex 和 Claude Code 会话可以连接到飞书群。典型流程是：本地会话把截图、录屏或阶段性结果发送到群里，设计师和产品经理在群里提及机器人给出反馈，本地会话收到消息后继续修改、验证并回传。

## 阶段结论

推荐方向是：核心能力优先基于 `@larksuiteoapi/node-sdk` 的 `createLarkChannel` 做一个窄接口的核心 MCP；`lark-cli` 用于本地验证和运维辅助；`cc-connect` 作为成熟参考或外部可选集成，不作为第一版核心依赖；`openclaw-lark` 主要借鉴它的权限、消息归一化和附件处理经验。

原因：

- `node-sdk` 已经提供高层 `Channel`，覆盖长连接、消息归一化、提及过滤、发送文本/富文本/图片/文件/音频/视频、流式回复、卡片回调、资源下载等能力。
- `cc-connect` 功能非常接近“把本地编码代理接到聊天平台”，但它是一个完整的 Go 常驻服务，覆盖多平台、多代理、会话管理、网页管理、计划任务等。直接嵌入会带来比当前目标更大的产品面和运维面。
- `lark-cli` 已经能跑通 `event consume im.message.receive_v1`、`im +messages-send`、`im +messages-reply`、资源下载等动作，适合作为最小原型验证工具，但命令行输出和版本变化不适合作为核心运行时契约。
- 官方 `lark-openapi-mcp` 是 OpenAPI 工具型 MCP，适合让代理主动调用飞书接口，但不负责把群消息事件主动推给本地会话，所以不能单独替代事件入口。

## 当前实现状态

已开始落地一个 Node.js 包的双入口骨架：

- 命令行入口：`curiosea-lark-connect`
- MCP 入口：`curiosea-lark-connect mcp`

第一步先验证命令形状、配置模型和 MCP 基础协议；随后已经引入官方 `@larksuiteoapi/node-sdk`，完成最小长连接监听器。

当前已实现命令：

- `setup`：不带参数时输出飞书应用配置引导。
- `setup --app-id cli_xxx --app-secret ...`：保存应用级本地配置，不保存群聊 ID。
- `config show/path/clear`：查看配置状态、查看配置文件路径、清除本地配置。
- `doctor`：输出本地配置状态。
- `doctor --live`：用已配置的应用凭据做真实飞书 API 检查，包括获取租户访问令牌和查询机器人身份；传入 `--chat-id` 时额外检查目标群访问。
- `debug listen-once --chat-id oc_xxx`：通过 `node-sdk Channel` 等待目标群里下一条提及机器人消息，输出归一化消息后退出。
- `daemon start/status/stop`：启动、查看、停止本地守护进程；启动时从本地配置读取应用凭据，群聊由 MCP 绑定工具传入。
- `mcp`：启动 MCP 标准输入输出服务。

尚未实现：

- 从钥匙串或 `lark-cli` 读取明文 `appSecret`
- 长等待的 agent 唤醒 skill
- 音视频资源下载
- 插件打包和面向非开发同事的协作 skill

## 已调研资产

### larksuite/node-sdk

本地浅克隆路径：`/tmp/lark-connect-research/node-sdk`

关键文件：

- `docs/channel.md`
- `channel/channel.ts`
- `channel/types.ts`
- `channel/outbound/sender.ts`
- `channel/outbound/media/uploader.ts`
- `ws-client/index.ts`

可复用点：

- `createLarkChannel({ policy: { requireMention: true } })` 已经匹配“群里提及机器人后才处理”的主路径。
- `NormalizedMessage` 暴露 `chatId`、`chatType`、`senderId`、`content`、`resources`、`mentions`、`mentionedBot`、`rootId`、`threadId`、`replyToMessageId`。
- `send` 支持文本、富文本、图片、文件、音频、视频、卡片，并支持 `replyTo` 和 `replyInThread`。
- `im.v1.messageResource.get` 可以通过 `message_id`、`file_key` 和资源类型取回消息里的附件；`downloadResource(fileKey, type)` 便捷方法只适合部分上传资源，不能覆盖本次真实文件消息里的 `file_v3_...` 资源。
- 媒体上传实现包含本地文件目录限制、系统目录阻断、远程地址防内网探测、大小限制等安全处理。

风险：

- 这是一个比较新的高层模块，需要用真实飞书群做稳定性验证。
- 如果同一个飞书应用被多个本地进程复用，需要确认是否会出现事件被多条长连接分摊的问题；`cc-connect` 已经专门处理了这个问题。

### larksuite/openclaw-lark

本地浅克隆路径：`/tmp/lark-connect-research/openclaw-lark`

关键文件：

- `src/channel/plugin.ts`
- `src/channel/event-handlers.ts`
- `src/messaging/inbound/handler.ts`
- `src/messaging/inbound/dispatch.ts`
- `src/messaging/outbound/actions.ts`
- `src/messaging/outbound/media.ts`

可复用点：

- 完整的飞书插件分层：账号、权限、入站解析、消息门禁、附件解析、分发、出站发送。
- 处理了自回声过滤、重复事件、过期消息、群提及、线程上下文、机器人之间循环、卡片交互等问题。
- 提供了“当前频道消息工具”的经验：代理可以用统一消息动作发送文本、卡片、媒体、回复、表情和撤回。

风险：

- 依赖 OpenClaw 插件接口，不能直接拿来给 Codex 插件使用。
- 功能面偏大，第一版不宜照搬。

### chenhg5/cc-connect

源码克隆因网络中断没有完整落盘，改用 GitHub 原始文件调研。

关键文件和文档：

- `README.md`
- `docs/feishu.md`
- `docs/usage.md`
- `docs/bridge-protocol.md`
- `platform/feishu/feishu.go`
- `platform/feishu/ws_shared.go`
- `agent/codex/codex.go`
- `agent/claudecode/claudecode.go`
- `core/bridge.go`
- `core/session.go`

可复用点：

- 已支持 Claude Code、Codex、Cursor、Gemini 等本地编码代理。
- 飞书使用长连接，无需公网地址。
- 支持群聊、私聊、图片文件、语音、流式回复、会话命令、权限模式切换、目录切换。
- 支持多个项目共用同一个飞书应用时共享一条长连接，避免飞书把事件随机分配给不同连接。
- 有外部桥接协议，可以让外部平台适配器通过 WebSocket 接入 `cc-connect`。

风险：

- 它是完整远程控制产品，不只是“群验收闭环”。
- 如果直接依赖，会把会话命令、权限模式、网页管理、计划任务、多平台等复杂度一起带进来。
- 插件目标是服务本地 Codex 和 Claude Code 会话，`cc-connect` 更像并行产品或可选后端，而不是内部库。

### lark-cli

本机版本：`1.0.47`，`doctor` 提示有新版本可更新。

已确认能力：

- `lark-cli event list` 包含 `im.message.receive_v1`。
- `lark-cli event schema im.message.receive_v1` 输出结构包含 `event_id`、`message_id`、`chat_id`、`chat_type`、`content`、`message_type`、`sender_id`。
- `lark-cli event consume im.message.receive_v1` 以逐行 JSON 输出事件，适合最小监听验证。
- `lark-cli im +messages-send` 支持文本、富文本、图片、文件、视频、音频，并支持本地相对路径。
- `lark-cli im +messages-reply` 支持回复消息和 `--reply-in-thread`。
- `lark-cli im +messages-resources-download` 支持下载消息中的图片和文件资源。

定位：

- 用作原型验证、调试、健康检查和人工运维。
- 不建议把它作为核心 MCP 服务运行时依赖。

### 官方文档和 MCP

相关资料：

- 飞书接收消息事件：`im.message.receive_v1`
- 飞书事件接收支持长连接模式。
- 飞书消息发送接口支持向用户或群发送消息。
- 图片和文件需要先上传，再以对应 key 发送。
- 官方 `lark-openapi-mcp` 能把飞书开放接口封装成 MCP 工具，但它不提供群消息事件监听入口。

## 候选方案

| 方案 | 形态 | 优点 | 代价 |
| --- | --- | --- | --- |
| A. 基于 `node-sdk Channel` 自研窄核心 | TypeScript MCP 服务直接使用 `createLarkChannel` | 最贴近 Codex 插件生态；依赖少；接口可按群验收闭环收窄 | 要自己做会话路由、状态存储、权限策略和 Codex/Claude Code 连接 |
| B. 直接复用 `cc-connect` | 把 `cc-connect` 当外部服务或后端 | 已覆盖本地代理、飞书群、附件、会话管理 | 产品面过大；Go 常驻服务与 Codex 插件边界不自然；定制成本可能变高 |
| C. 基于 `lark-cli` 管道拼装 | MCP 服务调用 `lark-cli event consume` 和 `lark-cli im` | 最快验证；几乎不用写飞书协议代码 | 命令行输出不是稳定库接口；错误处理和并发控制较弱 |
| D. 只接官方 `lark-openapi-mcp` | 代理通过 MCP 主动调用飞书 API | 官方 MCP，工具覆盖面广 | 缺少群消息主动事件入口，不能完成提及后自动触发 |

建议第一阶段选 A，局部借鉴 B，使用 C 做验收辅助，同时可选接入 D 作为额外飞书工具。

## 建议的第一版架构

```text
Feishu group
  -> Feishu Open Platform WebSocket event
  -> LarkChannel runtime
  -> inbound normalizer
  -> session router
  -> MCP tools/resources/prompts
  -> Codex / Claude Code local session
  -> outbound sender
  -> Feishu group reply or thread reply
```

核心 MCP 暴露的能力建议保持窄接口：

- `connect_lark_channel`：启动长连接，声明机器人身份和可处理群。
- `wait_for_lark_mention`：阻塞或订阅下一条提及消息，返回归一化消息、附件本地路径和回复上下文。
- `send_lark_message`：向群发送文本或富文本，支持回复原消息和线程回复。
- `send_lark_artifact`：发送截图、录屏、日志、构建产物等文件。
- `download_lark_resource`：把消息里的图片或文件资源落到本地临时目录。
- `ack_lark_task`：用表情或短消息标记已收到、处理中、已完成。

第一版状态模型：

- `chat_id + root_id/thread_id` 作为验收线程标识。
- `workspace path + session id + chat thread` 建立绑定。
- 默认只响应群内提及机器人消息。
- 附件默认落到受控临时目录，发送本地文件默认只允许工作区和明确配置的产物目录。

## 需要真实验证的问题

1. 飞书真实群中 `im.message.receive_v1` 对“只提及机器人”和“普通群消息”的触发差异。
2. `node-sdk Channel` 在同一个应用被多个本地进程连接时的事件分发行为。
3. 图片、文件、视频上传在飞书侧的大小限制、格式限制和消息展示效果。
4. 截图和录屏发送后，设计师在同一线程回复时，`rootId`、`threadId`、`replyToMessageId` 的实际值。
5. Codex 与 Claude Code 两种会话的外部输入方式：是走 MCP 工具轮询、命令行标准输入、还是各自的会话恢复接口。
6. 安全策略：群白名单、用户白名单、是否允许非负责人触发本地文件修改、是否要求手动批准。

## 真实群验证记录

验证时间：2026-06-13

群信息：

- 群名：`示例测试群`
- 群 ID：`oc_redacted`
- 群类型：普通群
- 机器人：当前 `lark-cli` 绑定应用的机器人

已验证：

- `lark-cli im +chat-search --as bot --query '示例测试群'` 可以查到群，说明机器人已在群内。
- `lark-cli im +messages-send --as bot --chat-id oc_redacted --text ...` 可以向群发送消息。
- `lark-cli event consume im.message.receive_v1 --as bot --timeout 90s --max-events 1` 可以收到群里提及机器人的消息事件。
- `lark-cli im +messages-reply --as bot --message-id ... --text ...` 可以按收到的 `message_id` 回复原消息。
- `curiosea-lark-connect doctor --live` 可以用应用密钥完成真实 API 检查，确认机器人身份；传入 `--chat-id` 时也能确认目标群访问。
- `curiosea-lark-connect debug listen-once --chat-id ...` 可以通过 `node-sdk Channel` 收到目标群里的结构化机器人提及，并在打印结果后以退出码 0 结束。
- 飞书输入框里普通 `@AI` 文本不会被识别为目标机器人提及；必须从提及候选里选中 `测试机器人`，事件里才会出现 `mentionedBot: true`。

实际收到的事件字段：

```json
{
  "type": "im.message.receive_v1",
  "event_id": "event_redacted",
  "message_id": "om_redacted_event",
  "chat_id": "oc_redacted",
  "chat_type": "group",
  "message_type": "text",
  "sender_id": "ou_redacted_sender",
  "content": "@测试机器人 收到"
}
```

`node-sdk Channel` 实际输出的归一化消息字段：

```json
{
  "messageId": "om_redacted_normalized",
  "chatId": "oc_redacted",
  "chatType": "group",
  "senderId": "ou_redacted_sender",
  "content": "",
  "rawContentType": "text",
  "mentionedBot": true,
  "mentionAll": false,
  "mentions": [
    {
      "key": "@_user_1",
      "openId": "ou_redacted_bot",
      "userId": null,
      "name": "测试机器人",
      "isBot": true
    }
  ],
  "resources": [],
  "createTime": 1781334121173
}
```

阶段判断：

- `lark-cli` 足够用于烟雾测试和人工调试。
- `lark-cli event` 输出是简化事件，不包含完整 `mentions` 数组、`root_id`、`thread_id` 等核心字段。核心 MCP 不应只依赖这个输出格式。
- 真实 API 检查不需要 `node-sdk`，可以作为轻量 `doctor --live` 保留；长连接监听已经使用 `node-sdk Channel`。
- `ack` 已经接入 `messageReaction.create`，默认给原始消息添加 `OK` reaction；如果真实应用缺少 reaction 写权限，会返回明确错误。
- `lark_connect_send_message` 已经提供第一版文本发送能力，目标限定为当前绑定群，并支持回复原消息。
- `lark_connect_send_file` 已经提供第一版本地文件发送能力，目标限定为当前绑定群，并支持回复原消息。
- `lark_connect_download_resource` 已经提供第一版入站资源下载能力，只允许下载当前会话已收到消息里的图片和文件。
- `lark_connect_send_image` 已经提供第一版原生图片发送能力，目标限定为当前绑定群，并支持回复原消息。
- `lark_connect_send_video` 已经提供第一版原生视频发送能力，目标限定为当前绑定群，并支持回复原消息；调用方必须提供本地封面图路径。
- 专用图片发送已用 `lark-cli --image` 和 `node-sdk Channel.send({ image: { source } })` 在测试群验证，返回消息类型为 `image`。
- 专用视频发送已用 `lark-cli --video --video-cover` 和 `node-sdk Channel.send({ video: { source, coverImageKey } })` 在测试群验证，返回消息类型为 `media`。`node-sdk` 能自动上传 MP4，但封面必须先上传成 `image_key` 再作为 `coverImageKey` 传入；无封面视频虽然返回消息 ID，但后续读取消息详情时飞书返回 500，不能作为稳定路径。
- `lark_connect_send_image` 已通过本仓库 MCP 标准输入输出入口真实发送到测试群，消息 ID 为 `om_redacted_image`，飞书侧 `msg_type` 为 `image`。
- `lark_connect_send_video` 已通过本仓库 MCP 标准输入输出入口真实发送到测试群，消息 ID 为 `om_redacted_video`，飞书侧 `msg_type` 为 `media`。
- `node-sdk createLarkChannel` 已经确认能返回 `mentionedBot`、`mentions`、`resources` 等关键字段；本次普通群直接提及没有返回 `rootId`、`threadId`、`replyToMessageId`，这些需要在线程回复和附件场景继续验证。
- 官方 `node-sdk` 的底层 `WSClient` 会创建内部清理定时器；一次性命令需要在打印结果后显式退出，避免命令行进程被内部定时器挂住。长期运行的 MCP 服务不走这个一次性退出路径。
- `lark_connect_wait_messages` 只适合作为短等待工具；长时间等待设计师或产品反馈时，不应该阻塞当前 agent turn。后续插件 skill 需要区分 runtime：Codex 用 thread automation 定时唤醒后 `poll`，Claude Code 用 loop monitor 定时检查后 `poll`。

## 下一步建议

1. 用真实群继续验证线程回复、图片、文件、录屏附件，确认 `rootId`、`threadId`、`replyToMessageId`、`resources` 和下载后的文件可读性。
2. 评估是否需要音视频下载和单独添加 reaction 的工具；当前文本、文件、图片、视频发送，图片 / 文件下载，以及确认 reaction 已经覆盖主要验收素材。
3. 最后再把 MCP、配置引导和协作说明打包进 Codex 插件，并补配套 skill。

## 参考资料

- https://github.com/larksuite/node-sdk
- https://github.com/larksuite/openclaw-lark
- https://github.com/chenhg5/cc-connect
- https://github.com/larksuite/cli
- https://github.com/larksuite/lark-openapi-mcp
- https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket
- https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
- https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/image/create
