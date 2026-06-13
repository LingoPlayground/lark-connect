# Agent MCP 配置

这份文档说明如何在当前仓库里让 Codex 和 Claude Code 连接 `curiosea-lark-connect` 的 MCP（Model Context Protocol，模型上下文协议）服务。

## Codex

Codex 的项目级配置文件是：

```text
.codex/config.toml
```

当前注册内容：

```toml
[mcp_servers.lark-connect]
command = "node"
args = ["src/cli.js", "mcp"]
```

在仓库根目录验证：

```bash
codex mcp list
```

输出里应该能看到 `lark-connect`。

## Claude Code

Claude Code 的项目级配置文件是：

```text
.mcp.json
```

当前注册内容：

```json
{
  "mcpServers": {
    "lark-connect": {
      "type": "stdio",
      "command": "node",
      "args": ["src/cli.js", "mcp"],
      "env": {}
    }
  }
}
```

在仓库根目录验证：

```bash
claude mcp list
```

Claude Code 第一次看到项目级 MCP 服务时，可能会显示等待批准。进入 Claude Code 交互会话后批准这个项目级服务，再依赖它处理飞书消息。

## 运行流程

1. 先执行 `curiosea-lark-connect setup --app-id cli_xxx --app-secret <secret>` 保存飞书应用凭据。这个步骤不配置群聊。
2. 执行 `curiosea-lark-connect doctor --live` 检查应用凭据和机器人身份。
3. 执行 `curiosea-lark-connect daemon start` 启动守护进程。
4. 在当前仓库里启动 Codex 或 Claude Code。
5. 调用 `lark_connect_bind_session`，传入：
   - `chatId`：飞书群 `chat_id`
   - `agentKind`：`codex` 或 `claude-code`
   - `agentSessionId`：当前 Codex thread 或 Claude Code session
   - `workspace`：当前仓库路径
   - `replace`：明确接管已有群绑定时传 `true`
6. 调用 `lark_connect_wait_messages` 或 `lark_connect_poll_messages` 领取消息。
7. 如果收到的消息 payload 里有 `resources`，并且需要读取图片或文件内容，调用 `lark_connect_download_resource` 下载到本地。
8. 需要向群里回传简短结果或追问时，调用 `lark_connect_send_message`。默认发到当前绑定群；传 `replyToMessageId` 时会回复那条原消息。
9. 需要把截图发回群里时，调用 `lark_connect_send_image`。默认发到当前绑定群；传 `replyToMessageId` 时会回复那条原消息。
10. 需要把录屏发回群里时，调用 `lark_connect_send_video`，并同时传入本地封面图路径 `coverImagePath`。视频会以飞书原生视频消息发送。
11. 需要把日志、构建产物或其它附件发回群里时，调用 `lark_connect_send_file`。
12. 处理完反馈后，调用 `lark_connect_ack_message` 确认消息。这个调用会给原始飞书消息添加 `OK` reaction，让群里的同事知道反馈已经被 agent 收到。

只有真实 @ 机器人的目标群消息会进入队列。普通群消息、或者只是在文本里写机器人名字的消息，不会触发 agent。

Claude Code 需要长时间等待时，可以把下面的命令放到 background shell。它复用守护进程的 wait 逻辑，默认建议等待 5 分钟；`agentSessionId` 必须复用第 5 步绑定时传入的同一个值。shell 结束后 Claude Code 会唤醒当前 Agent，再根据输出继续处理消息或进入下一轮等待。

```bash
npx -y curiosea-lark-connect@latest wait --agent-session-id <绑定时使用的 agentSessionId> --timeout-ms 300000
```

如果 `ack` 返回 `LARK_REACTION_FAILED`，通常是飞书应用还没有开通 `im:message` 或 `im:message.reactions:write_only` 权限，或者机器人不在原消息所在会话内。

视频发送要求提供封面图，是因为真实群验证里无封面视频虽然能拿到消息 ID，但读取消息详情时飞书会返回服务端错误。当前工具只暴露稳定路径。

如果需要单独确认某个群里的提及事件是否能进入本地，可以使用 `curiosea-lark-connect debug listen-once --chat-id oc_xxx`。这是调试入口，不是正式 agent 消费路径。

## 插件方向

当前仓库已经打包了双运行时插件，包含 MCP 服务入口、飞书连接配置 skill，以及面向 Agent 的群消息响应 skill。

后续还需要补一份面向非开发同事的协作 skill，说明如何 @ 机器人、什么样的反馈最有用，以及可以期待 Agent 返回什么状态。

插件版本也应该保持守护进程显式启动。MCP 工具在守护进程不在线时继续返回 `DAEMON_NOT_RUNNING`，不要自动拉起后台进程。
