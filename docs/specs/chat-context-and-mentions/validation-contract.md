# 验收契约

## 自动化验证

- `npm test` 覆盖飞书消息历史客户端、守护进程本地接口、MCP 工具转发、发送文本 @ 与回复参数。
- `npm test` 覆盖实时消息发送者类型保留，以及群成员 / 可识别机器人查询。
- `npm run lint` 覆盖新增代码风格。
- `npm run build` 覆盖新增模块语法检查。

## 行为验证

- `lark_connect_get_chat_context` 未传 `limit` 时请求最近 10 条绑定聊天消息。
- `lark_connect_get_chat_context` 传入非法 `limit` 时返回 `INVALID_REQUEST`。
- `lark_connect_get_chat_context` 对未绑定 session 返回 `SESSION_NOT_BOUND`。
- `lark_connect_send_message` 可以传 `replyToMessageId` 和 `replyInThread`。
- `lark_connect_send_message` 可以传 `mentions`，并允许 `text` 为空但 `mentions` 非空。
- `lark_connect_wait_messages` 返回的消息 payload 包含从飞书原始事件提取的 `senderType`。
- `lark_connect_get_chat_members` 返回绑定聊天的人类成员、可识别机器人、分页信息和机器人覆盖范围说明。
- `lark_connect_get_chat_members` 对未绑定 session 返回 `SESSION_NOT_BOUND`，传入非法分页参数时返回 `INVALID_REQUEST`。
- 文档说明 Agent 开始处理群协作任务前应先读取上下文；监听超时后继续短等待或建立约 5 分钟心跳。
