---
name: lark-connect-setup
description: 为飞书连接准备官方 lark-cli 配置档案、机器人或用户身份和授权；验证指定身份是否能读取目标聊天。不处理旧版 lark-connect 凭据。
---

# 飞书连接配置

本插件使用官方 `lark-cli`。用户自行按其引导创建机器人应用或登录、授权用户身份；插件不读取、迁移或删除旧版 lark-connect 配置，也不要求启动本仓库守护进程。

1. 运行 `lark-cli --version` 和 `lark-cli profile list`。缺少工具时，按 [官方安装说明](https://github.com/larksuite/cli) 安装，之后用 `lark-cli --help` 确认命令。
2. 让用户明确选择配置档案及 `bot` 或 `user` 身份。创建或绑定配置档案时，优先运行 `lark-cli config init --name <名称>` 并按交互引导操作；已有应用也可查看 `lark-cli profile add --help`，从标准输入提供应用密钥，避免在命令参数、日志或聊天中暴露。不要替用户猜测配置档案，也不要自动调用 `profile use` 切换默认档案。
3. 用户身份需要授权时，用 `lark-cli --profile <名称> auth login --domain im` 按设备授权引导操作；如果当前智能体工具无法一边等待一边展示登录链接，按 `auth login --help` 使用 `--no-wait --json`，待用户完成授权后继续。机器人身份需要飞书后台授予相应权限并订阅 `im.message.receive_v1` 事件。是否需要额外权限以实际操作和 `lark-cli` 错误为准。
4. 用 `lark-cli --profile <名称> doctor`、`lark-cli --profile <名称> whoami --as bot|user` 检查当前身份。再以**同一身份**读取目标聊天：`lark-cli --profile <名称> im +chat-messages-list --as bot|user --chat-id <标识> --page-size 1`。若权限不足，报告缺失权限或平台限制；不要静默切换身份。
5. 旧版机器人连接若仍在运行，先引导用户停止旧连接，再用新技能绑定同一个聊天，避免两个接收者同时回复。新连接失败时，旧版配置仍在原处，可由用户手动恢复；本插件不会操作它。

用户准备好配置档案后，继续使用 `lark-connect` 技能完成聊天查找、绑定和持续响应。不要把应用密钥、访问令牌或原始配置文件发送到聊天。
