# Direct Chat Signal Spec

## Why / 背景

飞书的群聊可以通过机器人可见群搜索拿到 `chatId`，但机器人身份不能搜索或列出用户与机器人的 P2P 单聊。用户身份可以通过 `lark-cli` 列出单聊，但当前插件的配置模型只保存应用级 `appId` 和 `appSecret`，不引入用户授权。

为了让非开发用户也能绑定机器人单聊，同时保持本地配置简单，采用挑战文本方案：智能体生成唯一挑战文本，用户在机器人单聊里原样发送，daemon 从收到的 P2P 消息中发现 `chatId`。

## Findings / 调研事实

- `im.v1.chat.search` 和 `im.v1.chat.list` 都只覆盖群聊；机器人身份不能列出 P2P 单聊。
- `lark-cli im +chat-list --as user --types=p2p,group` 可以列出当前用户的单聊，但这依赖用户授权，不属于当前插件的默认配置模型。
- 现有 daemon 已经接收所有飞书消息事件；未绑定 P2P 消息此前会被视为未路由消息。

## What / 行为契约

- 新增 MCP 工具 `lark_connect_wait_direct_chat_signal`，等待用户给当前机器人单聊发送指定挑战文本。
- 工具输入必须包含 `challengeText`、`agentKind`、`agentSessionId` 和 `workspace`，可选 `timeoutMs`。
- 只有未绑定的 P2P 消息且文本修剪后与挑战文本精确一致时，才返回单聊 `chatId`。
- 群聊消息、已绑定单聊消息、非匹配挑战文本都不能完成单聊发现。
- 成功结果只返回 `signal` 和 `signal.bindingInput`；不会自动调用绑定。
- 为降低用户发送太快导致的竞态，daemon 会在内存中保留少量最近未绑定 P2P 消息，用于后续等待调用匹配。
- 这部分缓冲是短期内存状态，最多保留 5 分钟或 50 条消息；重复飞书消息事件不能产生多个可消费信号。
- 替换当前绑定时，旧的消息等待、单聊发现等待和未绑定 P2P 缓冲都必须清空，避免旧会话的等待结果泄漏到新绑定。

## Out of Scope / 非目标

- 不引入飞书用户授权或用户 token 保存。
- 不通过通讯录、用户搜索或 `lark-cli` 发现机器人单聊。
- 不持久化单聊发现记录。
- 不改变同一时间只能有一个聊天绑定的约束。
