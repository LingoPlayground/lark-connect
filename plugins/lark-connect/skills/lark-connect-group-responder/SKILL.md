---
name: lark-connect-group-responder
description: 长时间响应飞书或 Lark 群里的机器人提及消息。当用户想把当前 Codex thread 或 Claude Code session 绑定到群聊、发送截图、录屏、文件或文本、等待或轮询提及机器人的消息、确认已处理消息、下载收到的资源，并持续根据群里消息处理任务时使用。
---

# 飞书群消息响应

在 lark-connect 已完成配置且守护进程正在运行后使用这个技能。这个技能的目标不是一次性交互，而是让智能体在较长时间内响应群里提及机器人的消息，并把处理结果继续发回群里。

## 绑定

用 `lark_connect_bind_session` 把一个飞书群绑定到当前智能体会话。

必需值：

- `chatId`：飞书群聊 ID，通常形如 `oc_xxx`。
- `agentKind`：Codex 使用 `codex`，Claude Code 使用 `claude-code`。
- `agentSessionId`：Codex thread ID 或 Claude Code session ID。
- `workspace`：当前工作区的绝对路径。

不要编造 `agentSessionId`。如果当前运行时没有提供稳定的 thread 或 session 标识，先让用户提供一个本轮会话专用的稳定标识，再继续绑定。

当前 daemon 同一时间只允许一个绑定。只有当用户希望这个群停止绑定到旧会话时，才传入 `replace: true`。

## 发送

按产物类型选择最窄的工具：

- `lark_connect_send_message`：发送短文本。
- `lark_connect_send_image`：发送截图和界面静态图。
- `lark_connect_send_video`：发送录屏；需要提供本地封面图。
- `lark_connect_send_file`：发送日志、归档和非媒体附件。

回复具体群消息时传入 `replyToMessageId`。只有飞书话题上下文重要时才使用 `replyInThread`。

## 短等待

刚调用这个技能后，先调用 `lark_connect_wait_messages`，`timeoutMs` 设置为 `60000`。每次处理完一条消息并回复后，也用同样的 `timeoutMs: 60000` 再等待 1 分钟。

只有明确提及机器人的消息会被路由给智能体。立即检查时可以用 `lark_connect_poll_messages`。

如果等待返回消息：

1. 阅读消息和资源列表。
2. 必要时用 `lark_connect_download_resource` 下载图片或文件。
3. 执行用户要求的处理任务。
4. 用发送工具回复处理结果。
5. 调用 `lark_connect_ack_message` 确认这条消息。
6. 再次用 `lark_connect_wait_messages` 等待 1 分钟。

## 长时间监听

如果 `lark_connect_wait_messages` 等待 1 分钟后超时，不要继续阻塞当前回合。

- Codex：使用 thread automation 创建约 5 分钟后的定时唤醒。唤醒后先 `poll`，有消息就处理、回复、ack，然后再做一次 1 分钟 `wait`。
- Claude Code：使用 loop monitor，每轮间隔约 5 分钟。每轮先 `poll`，有消息就处理、回复、ack，然后再做一次 1 分钟 `wait`。

默认最多循环 10 次。除非用户明确要求继续监听，到达 10 次后停止自动唤醒，并向用户说明本轮群消息响应已经结束。

## 错误处理

- 如果轮询或等待返回 `SESSION_NOT_BOUND`，先绑定会话再重试。
- 如果返回 `DAEMON_NOT_RUNNING`，先启动守护进程再重试。
- 如果发送或下载失败，向群里或当前对话说明失败原因，不要静默吞掉。

## 确认

阅读并处理一条已投递消息后，调用 `lark_connect_ack_message`。

确认会消费这条消息，并给原始飞书消息添加 `OK` reaction，让人类用户知道消息已经被收到。

## 安全

- 不要响应没有提及机器人的普通群消息。
- 不要编造群聊 ID 或会话 ID；从当前运行时、用户输入或已有工具输出中获取。
- 不要把密钥、本地配置文件或私密环境变量转发到群里。
