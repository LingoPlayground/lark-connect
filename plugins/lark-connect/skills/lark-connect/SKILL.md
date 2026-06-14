---
name: lark-connect
description: 连接飞书或 Lark 群聊和单聊。当用户想配置 lark-connect、搜索机器人可见群聊、用挑战码发现机器人单聊、把当前 Codex thread 或 Claude Code session 绑定到聊天、读取聊天上下文、查询群成员和群内机器人、@ 人类同事或其他机器人、发送截图、录屏、文件或文本、等待或轮询消息、确认已处理消息、下载收到的资源，并持续根据聊天消息处理任务时使用。
---

# 飞书连接

在 lark-connect 已完成配置且守护进程正在运行后使用这个技能。这个技能的目标不是一次性交互，而是让智能体在较长时间内响应飞书或 Lark 聊天里的消息，并把处理结果继续发回对应聊天。

## 准备

如果 MCP 工具返回 `DAEMON_NOT_RUNNING`，先按 `lark-connect-setup` 技能启动守护进程。

如果目标是群聊且用户没有提供 `chatId`，先用 `lark_connect_search_chats` 按用户给出的群名或关键词搜索机器人可见群聊。

搜索结果处理规则：

- 如果只有一个明显匹配项，使用该项的 `chatId` 继续绑定。
- 如果有多个相近结果，把候选群名和 `chatId` 简短列给用户，让用户选择。
- 如果没有结果，提醒用户确认群名；如果目标群还不存在，请创建群；如果群已存在，请把当前飞书应用的机器人拉入群后再重试搜索。

如果目标是单聊且用户没有提供 `chatId`，不要要求用户手动查找 `chatId`。生成一段唯一挑战文本，例如 `lark-connect bind 8F2K`。先把这段文本展示给用户，请用户打开当前机器人单聊并原样发送；然后调用 `lark_connect_wait_direct_chat_signal`，传入同一段 `challengeText`、`agentKind`、`agentSessionId`、`workspace` 和 `timeoutMs: 60000`。工具返回 `signal.bindingInput` 后，再用其中的 `chatId` 调用 `lark_connect_bind_session`。

如果 `lark_connect_wait_direct_chat_signal` 返回 `signal: null`，说明 1 分钟内没有收到完全匹配的机器人单聊消息。不要绑定猜测出来的 `chatId`；请用户确认打开的是当前飞书应用的机器人单聊，并确认发送文本和挑战文本完全一致，然后生成新的唯一挑战文本重试。

`lark_connect_search_chats` 搜索的是机器人可见群聊，不用于发现用户和机器人的单聊。`lark_connect_wait_direct_chat_signal` 只负责发现单聊，不会自动绑定。

## 绑定

用 `lark_connect_bind_session` 把一个飞书聊天绑定到当前智能体会话。

必需值：

- `chatId`：飞书聊天 ID，通常形如 `oc_xxx`。可以来自 `lark_connect_search_chats` 的结果、`lark_connect_wait_direct_chat_signal` 的 `signal.bindingInput.chatId`，也可以由用户提供。
- `agentKind`：Codex 使用 `codex`，Claude Code 使用 `claude-code`。
- `agentSessionId`：Codex thread ID 或 Claude Code session ID。
- `workspace`：当前工作区的绝对路径。

不要编造 `agentSessionId`。如果当前运行时没有提供稳定的 thread 或 session 标识，先让用户提供一个本轮会话专用的稳定标识，再继续绑定。

当前 daemon 同一时间只允许一个绑定。只有当用户希望这个聊天停止绑定到旧会话时，才传入 `replace: true`。

## 场景化工具流程

先按场景选择工具，不要从工具清单倒推行动：

- 进入已有聊天或刚完成绑定：调用 `lark_connect_get_chat_context`，默认读取最近 10 条消息，返回顺序是新到旧；先建立协作背景，再进入 1 分钟短等待。
- 收到一条孤立的 `wait` 或 `poll` 消息：如果缺少上下文、引用关系或前因后果，先调用 `lark_connect_get_chat_context`，再决定怎么处理。
- 定位要 @ 的对象：调用 `lark_connect_get_chat_members`。需要人类同事时看 `members`；当 `memberIdType` 是 `open_id` 时，把 `memberId` 作为 `mentions[].openId`。需要其他机器人时看 `bots`，并使用机器人结果里的 `openId`。
- 机器人到机器人协作：先用 `lark_connect_get_chat_members` 找目标机器人，再用 `lark_connect_send_message` 传 `mentions`。如果是在响应某条消息，同时传入原消息的 `replyToMessageId`。
- 回复某条具体消息：优先用 `replyToMessageId`，让飞书里能看到回复关系；只有话题上下文明确需要时才使用 `replyInThread`。
- 发送产物给人验看：截图或静态界面用 `lark_connect_send_image`，录屏用 `lark_connect_send_video`，日志或压缩包用 `lark_connect_send_file`，简短说明用 `lark_connect_send_message`。
- 处理收到的图片或文件：从 `wait` 或 `poll` 返回的 `resources` 里取 `fileKey`，再调用 `lark_connect_download_resource`。
- 判断发送方是不是机器人：优先看投递消息里的 `senderType`。如果 `senderType: "bot"` 或 `senderType: "app"`，按机器人或应用发送者处理；需要名字时再用 `lark_connect_get_chat_members` 的 `bots` 结果按 `openId` 交叉确认。
- 完成一条投递消息：先回复或说明处理结果，再调用 `lark_connect_ack_message`。历史消息不需要确认，只有 `wait` 或 `poll` 投递给当前会话的消息才需要确认。

## 上下文

开始处理协作任务前，先调用 `lark_connect_get_chat_context` 读取当前绑定聊天的近期消息；不传 `limit` 时默认最近 10 条，返回顺序是新到旧。这个工具用于理解人类协作背景、消息引用关系、谁在讨论、以及是否需要回复或 @ 人类同事和其他机器人。

最佳实践：

- 刚绑定并进入一个已有聊天时，先读一次上下文，然后继续短等待。上下文读取不是监听，不能替代 `lark_connect_wait_messages` 或 `lark_connect_poll_messages`。
- `wait` 或 `poll` 返回的单条消息缺少背景时，先读上下文再处理，避免只看孤立消息就行动。
- `wait` 或 `poll` 返回的消息如果 `senderType` 是 `bot` 或 `app`，把它视为机器人或应用发送者；回复时可以结合 `replyToMessageId` 保持上下文。
- 不要对上下文里的历史消息调用 `lark_connect_ack_message`；只有 `wait` 或 `poll` 投递给当前会话的消息才需要 ack。
- 如果需要 @ 人类同事或其他机器人，可以从上下文的 `sender` 或 `mentions` 字段取得标识；只有当 `sender.idType` 或 `mentions[].idType` 是 `open_id` 时，才能把对应 `id` 作为 `mentions[].openId`。不要编造用户或机器人标识。

需要查看聊天参与者时，调用 `lark_connect_get_chat_members`。它返回 `members` 和 `bots`：`members` 是群里的人类成员，`bots` 来自飞书 `/open-apis/im/v1/chats/{chat_id}/members/bots` 接口。机器人结果里的 `openId` 是机器人的 open_id，可以作为发送消息时的 @ 目标。

如果 `lark_connect_get_chat_members` 返回 `hasMore: true`，并且当前页没有找到目标对象，继续用返回的 `pageToken` 调用下一页，直到找到目标或 `hasMore` 为 false。不要只查第一页就判断成员不存在。

## 发送

按产物类型选择最窄的工具：

- `lark_connect_send_message`：发送短文本。
- `lark_connect_send_image`：发送截图和界面静态图。
- `lark_connect_send_video`：发送录屏；需要提供本地封面图。
- `lark_connect_send_file`：发送日志、归档和非媒体附件。

回复具体消息时传入 `replyToMessageId`。只有飞书话题上下文重要时才使用 `replyInThread`。

需要 @ 人类同事或其他机器人时，在 `lark_connect_send_message` 里传入 `mentions`，每项至少包含 `openId`，可选 `name` 和 `isBot`。如果只是想提醒某个对象，可以只传 `mentions` 不传 `text`。

发送前如果不知道该 @ 谁，先调用 `lark_connect_get_chat_members` 获取候选成员和群内机器人；如果用户提到的对象不在结果里，再读 `lark_connect_get_chat_context` 确认是否有历史提及或发言。

## 短等待

绑定成功后必须立即调用 `lark_connect_wait_messages`，`timeoutMs` 设置为 `60000`；这不是可选步骤。刚调用这个技能后，如果已经完成绑定，也要立刻进入这次 1 分钟等待。每次处理完一条消息并回复后，也用同样的 `timeoutMs: 60000` 再等待 1 分钟。

群聊只有明确提及机器人的消息会被路由给智能体。已绑定单聊不要求提及机器人。立即检查时可以用 `lark_connect_poll_messages`。

`lark_connect_wait_messages` 和 `lark_connect_poll_messages` 返回的 `diagnostics` 可用于排查监听问题。重点看 `deliverySource` 区分是 MCP 短等待、MCP 轮询还是 CLI 等待领取了消息；看 `queueBefore` 和 `queueAfter` 判断消息是否已经进入队列、是否已被投递。如果怀疑守护进程没有收到飞书事件，再用 `npx -y curiosea-lark-connect@latest logs --tail 50` 查看结构化日志。

如果等待返回消息：

1. 阅读消息和资源列表。
2. 必要时用 `lark_connect_download_resource` 下载图片或文件。
3. 执行用户要求的处理任务。
4. 用发送工具回复处理结果。
5. 调用 `lark_connect_ack_message` 确认这条消息。
6. 再次用 `lark_connect_wait_messages` 等待 1 分钟。

## 长时间监听

如果 `lark_connect_wait_messages` 等待 1 分钟后超时，不要把它当作任务完成。活跃会话里优先继续调用 `lark_connect_wait_messages` 做下一轮短等待。只有当前会话可能已经进入无人值守状态时，才建立一个约 5 分钟的心跳。此时只有两个选项：继续短等待，或者建立心跳。除非有人从会话里明确告知停止，否则不要结束监听。

- Codex：使用 thread automation 创建约 5 分钟后的定时唤醒。唤醒后先 `poll`，有消息就处理、回复、ack，然后再做一次 1 分钟 `wait`。如果 `poll` 仍然没有消息，继续建立下一轮约 5 分钟心跳，或者改用 `lark_connect_wait_messages` 做下一轮短等待。
- Claude Code：无人值守心跳场景可以使用 background shell 运行 `npx -y curiosea-lark-connect@latest wait --agent-session-id <绑定时使用的 agentSessionId> --timeout-ms 300000`。`agentSessionId` 必须复用本技能绑定步骤中传给 `lark_connect_bind_session` 的同一个值，不要改用未确认的运行时变量。命令结束后 Claude Code 会唤醒当前智能体；如果输出里有消息，就处理、回复、ack，然后再做一次 1 分钟 `wait`。如果输出里没有消息，回到两个选项：继续调用 `lark_connect_wait_messages`，或再次建立约 5 分钟心跳。活跃会话里不要用 background shell 替代 MCP 短等待。

## 错误处理

- 如果搜索不到目标群，提示用户创建群或把机器人拉入群后再重试。
- 如果单聊挑战等待超时，提示用户确认机器人单聊和挑战文本，再用新的挑战文本重试。
- 如果轮询或等待返回 `SESSION_NOT_BOUND`，先绑定会话再重试。
- 如果返回 `DAEMON_NOT_RUNNING`，先启动守护进程再重试。
- 如果 `lark_connect_get_chat_context` 返回 `LARK_CHAT_CONTEXT_FAILED`，提示用户确认应用具备读取群组历史消息权限、机器人已在群里，并保留绑定后继续用 `wait` 等待新消息。
- 如果 `lark_connect_get_chat_members` 返回 `LARK_CHAT_MEMBERS_FAILED`，提示用户确认应用具备读取群成员和群内机器人权限、机器人已在群里；需要 @ 对象时让用户在群里提及或提供可用 open_id。
- 如果发送或下载失败，向聊天或当前对话说明失败原因，不要静默吞掉。

## 确认

阅读并处理一条已投递消息后，调用 `lark_connect_ack_message`。

确认会消费这条消息，并给原始飞书消息添加 `OK` reaction，让人类用户知道消息已经被收到。

## 安全

- 不要响应没有提及机器人的普通群消息。
- 不要编造聊天 ID 或会话 ID；从当前运行时、用户输入或已有工具输出中获取。
- 不要把密钥、本地配置文件或私密环境变量转发到聊天里。
