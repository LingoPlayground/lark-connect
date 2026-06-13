# curiosea-lark-connect

`curiosea-lark-connect` 用本地守护进程和 MCP（Model Context Protocol，模型上下文协议）把 Codex 或 Claude Code 会话连接到飞书群。

当前最小可用版本支持：一个飞书群同一时间绑定一个 Agent 会话。本地守护进程负责维持飞书长连接；Codex 或 Claude Code 通过 MCP 工具绑定群聊、领取被 @ 机器人 的消息，并在处理完成后显式确认。

## 快速开始

安装依赖：

```bash
npm install
```

配置飞书应用凭据：

```bash
node src/cli.js setup
node src/cli.js setup --app-id cli_xxx --app-secret ...
node src/cli.js doctor --live
```

启动本地守护进程：

```bash
node src/cli.js daemon start
```

调试指定群的提及事件：

```bash
node src/cli.js debug listen-once --chat-id oc_xxx
```

在另一个终端停止守护进程：

```bash
node src/cli.js daemon stop
```

## Agent 配置

本仓库已经包含 Codex 和 Claude Code 的项目级 MCP 配置。

Codex 读取：

```text
.codex/config.toml
```

Claude Code 读取：

```text
.mcp.json
```

两份配置当前都指向仓库源码：

```bash
node src/cli.js mcp
```

等包发布后，可以切到：

```bash
npx curiosea-lark-connect@latest mcp
```

## 插件

本仓库同时提供 Codex 和 Claude Code 插件包装：

```text
plugins/lark-connect
```

插件内包含：

- `.codex-plugin/plugin.json`：Codex 插件清单。
- `.claude-plugin/plugin.json`：Claude Code 插件清单。
- `codex.mcp.json`：Codex 使用的 MCP 配置。
- `.mcp.json`：Claude Code 使用的 MCP 配置。
- `skills/`：配置飞书连接和长时间响应群消息的技能。

Codex 插件市场清单文件：

```text
.agents/plugins/marketplace.json
```

Claude Code 插件市场清单文件：

```text
.claude-plugin/marketplace.json
```

插件里的 MCP 配置面向发布后的包，默认通过下面的命令启动服务：

```bash
npx -y curiosea-lark-connect@latest mcp
```

## MCP 工具

MCP 服务暴露这些工具：

| 工具 | 用途 |
|---|---|
| `lark_connect_daemon_status` | 查看本地守护进程状态。 |
| `lark_connect_bind_session` | 把一个飞书群绑定到一个 Codex thread 或 Claude Code session。 |
| `lark_connect_poll_messages` | 立即轮询待处理的 @ 机器人消息。 |
| `lark_connect_wait_messages` | 限时等待 @ 机器人消息。 |
| `lark_connect_ack_message` | 确认一条消息已经处理完成，并给原始飞书消息添加 `OK` reaction。 |
| `lark_connect_send_message` | 向当前绑定群发送文本，可选回复某条原消息。 |
| `lark_connect_send_file` | 向当前绑定群发送本地文件，可选回复某条原消息。 |
| `lark_connect_send_image` | 向当前绑定群发送本地图片，可选回复某条原消息。 |
| `lark_connect_send_video` | 向当前绑定群发送本地视频和封面图，可选回复某条原消息。 |
| `lark_connect_download_resource` | 下载当前会话已收到消息里的图片或文件资源。 |

MCP 不会自动启动守护进程。守护进程不在线时，MCP 工具会返回 `DAEMON_NOT_RUNNING`，并给出启动命令：

```bash
curiosea-lark-connect daemon start
```

## 开发命令

```bash
npm test
npm run build
npm pack --dry-run
```

## 当前约束

- 状态只保存在内存里；守护进程重启后，绑定和队列都会丢失。
- `setup` 只保存飞书应用 ID 和应用密钥；群聊 ID 不进入全局配置，只在 MCP 绑定时传入。
- 一个飞书群同一时间只能绑定一个 Agent 会话。
- 只有真实 @ 机器人的群消息会进入队列；普通群消息不会触发 agent，也不会被 `ack` 添加 reaction。
- 消息消费必须显式确认；领取后未确认的消息仍然处于已投递状态。
- `ack` 会调用飞书 reaction 接口，应用需要具备 `im:message` 和 `im:message.reactions:write_only` 权限。
- 图片和视频应该优先使用专用媒体发送工具，飞书侧会显示为原生图片或视频消息。
- 视频发送第一版要求传入本地封面图；无封面视频在真实飞书验证中不稳定。
- 当前文件发送第一版只支持本地单文件，并统一按文件消息发送，适合日志、构建产物和其它附件。
- 当前资源下载第一版只支持已进入当前会话消息队列的图片和文件；还没有提供音频、视频、表情、批量下载或单独添加 reaction 的工具。
- 飞书 `root_id` 和 `thread_id` 只作为元数据保留，当前不参与路由。
- 守护进程 1 小时没有飞书事件或本地调用后会自动退出。
