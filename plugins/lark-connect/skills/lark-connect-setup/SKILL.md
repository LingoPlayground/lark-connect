---
name: lark-connect-setup
description: 配置 lark-connect。当用户需要连接飞书或 Lark 机器人应用、把应用凭据保存到本地、验证机器人访问权限、启动或检查守护进程，或者排查模型上下文协议工具返回 DAEMON_NOT_RUNNING 或缺少应用凭据时使用。
---

# 飞书连接配置

使用这个技能把本机准备好，之后智能体会话才能绑定到飞书聊天。

## 流程

1. 检查包命令是否可用：

```bash
npx -y curiosea-lark-connect@latest --help
```

后续示例都使用同一个发布包命令，除非用户已经明确全局安装了可用版本。

2. 如果缺少凭据，先输出配置引导：

```bash
npx -y curiosea-lark-connect@latest setup
```

用户提供应用 ID 和应用密钥后，保存到本地配置：

```bash
npx -y curiosea-lark-connect@latest setup --app-id cli_xxx --app-secret <secret>
```

不要在 setup 阶段要求或保存聊天 ID。聊天 ID 属于会话绑定参数。

3. 提醒用户确认飞书后台前置条件：

- 如果目标是群聊，机器人已经加入目标群。
- 如果目标是单聊，用户可以打开机器人单聊并发送智能体给出的挑战文本。
- 应用已经开通接收消息事件需要的权限和事件订阅。
- 如果后续需要发送消息、添加 reaction、下载资源，相应权限也要在飞书后台开通。

4. 凭据保存后运行真实连通性检查：

```bash
npx -y curiosea-lark-connect@latest doctor --live
```

5. 当模型上下文协议工具返回 `DAEMON_NOT_RUNNING` 时，启动守护进程：

```bash
npx -y curiosea-lark-connect@latest daemon start
```

`daemon start` 默认在后台启动并立即返回。不要在智能体对话里使用 `daemon start --foreground`，它会长时间占住当前 shell。

然后检查状态：

```bash
npx -y curiosea-lark-connect@latest daemon status
```

## 规则

- 不要把应用密钥回显给用户。
- 优先使用 `setup` 创建的本地配置文件；不要把密钥写入插件清单或模型上下文协议配置。
- 守护进程在 1 小时内没有飞书事件或本地智能体调用后会自动退出。后续调用再次返回 `DAEMON_NOT_RUNNING` 时，重新启动守护进程。
- 如果在智能体对话里执行配置，只在缺少凭据时说明用户需要打开的飞书应用后台页面。
