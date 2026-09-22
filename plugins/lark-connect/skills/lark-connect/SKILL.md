---
name: lark-connect
description: 把当前 Codex 或 Claude Code 会话连接到飞书群聊或单聊，使用指定的 lark-cli 配置档案和机器人或用户身份读取上下文、处理消息并持续响应；其他飞书操作按需直接使用 lark-cli。
---

# 飞书连接

本技能只协调一个飞书聊天与当前智能体会话。飞书读写直接使用 `lark-cli`；本技能目录下的 `scripts/session.mjs` 只保存本机绑定和扫描检查点。不要寻找旧版模型上下文协议工具、守护进程或 `curiosea-lark-connect` 命令。

## 选择身份与聊天

1. 按 `lark-connect-setup` 确认 `lark-cli` 可用。向用户说明将使用哪个配置档案，以及以机器人还是用户身份工作。所有飞书命令都显式传 `--profile <名称>` 和 `--as bot|user`；不要为了本次连接切换默认配置档案，也不要在失败时静默改用另一身份。
2. 按任务查找聊天。群聊用 `lark-cli --profile <名称> im +chat-search --as <身份> --query '<关键词>'`；用户身份的单聊用 `im +chat-list --as user --types p2p,group`。多候选时让用户选定。机器人单聊不可列举时，先启动一次 `event consume im.message.receive_v1 --as bot --max-events 1 --timeout 60s`，再请用户在目标机器人单聊发送唯一挑战文本，以返回的 `chat_id` 确认目标；超时或其他消息不能当成绑定依据。
3. 用所选身份执行 `im +chat-messages-list --chat-id <标识> --page-size 1`，确认聊天历史可读。若平台或权限阻止读取，不能声称该聊天可以可靠持续响应。记录群聊或单聊类型；机器人身份还需用 `whoami --as bot` 和聊天成员信息确认本应用与机器人的标识，供后续发送者和提及判断使用。
4. 从运行时取得当前 Codex 任务或 Claude Code 会话的稳定标识。不得编造会话标识。用本技能目录下脚本的**绝对路径**执行：

```bash
node <本技能目录>/scripts/session.mjs start --profile <名称> --as bot|user --chat-id <标识> --runtime codex|claude-code --session-id <稳定标识>
```

已有绑定时，只有用户明确要求接管，且旧会话的唤醒已撤销后，才加 `--replace`。`start` 返回连接代次 `generation` 与初始扫描位置 `scanThrough`。先读近期聊天消息建立上下文；连接前的旧消息只作背景，除非用户明确要求处理。

## 检查新消息

- 每次唤醒先调用 `node <本技能目录>/scripts/session.mjs status`。只处理 `connection.status=active` 且会话标识、连接代次仍与本轮一致的连接。使用返回的配置档案、身份和聊天标识，不从当前默认配置推断。
- 机器人活跃时可用 `lark-cli --profile <名称> event consume im.message.receive_v1 --as bot --max-events 1 --timeout 60s` 降低延迟。只接受目标聊天的事件；超时是正常结束。事件是候选信号，不能代替历史补查。用户身份没有对应的消息接收事件，直接检查历史。
- 在一轮检查开始时记录当前时间为窗口终点。从 `scanThrough` 前适度重叠的位置，用 `lark-cli --profile <名称> im +chat-messages-list --as <身份> --chat-id <标识> --start <起点> --end <终点> --order asc` 读取。逐页跟随 `has_more` 和 `page_token`；使用 `--page-all` 时也必须检查 `meta.pagination.complete`。按消息标识排除本轮重复结果，不能只看第一页或把空页当作完整结果。
- 话题群带时间窗的 `+chat-messages-list` 可能漏掉旧话题的新回复。遇到话题群，按 `lark-cli api --help` 和飞书接口文档核实参数后，用 `lark-cli --profile <名称> api GET /open-apis/im/v1/messages --as <身份> --params '{"container_id_type":"chat","container_id":"oc_xxx","only_thread_root_messages":false,"start_time":"<起点秒数>","end_time":"<终点秒数>","sort_type":"ByCreateTimeAsc","page_size":50}'` 读取并完整翻页。原始结果需要按消息标识读取详情。若上游不支持该查询或不能证明覆盖所有回复，报告持续响应不可用，不能推进检查点。
- 机器人身份先排除由当前应用自己发送的消息；机器人群聊只处理结构化提及了当前机器人的消息，机器人单聊无需提及。用户身份检查所选聊天的**全部**新消息，由智能体判断是否需要回应；不能按“发送者是本人”直接排除。通过回复关系、已知发送结果和当前身份的完成反应识别用户身份下智能体自己的输出，避免循环。
- 所有候选消息都已判断、所需操作已确认、分页完整且发送结果明确后，调用 `session.mjs checkpoint --session-id <标识> --generation <代次> --through <窗口终点>`。如果查询不完整、权限拒绝、发送结果不明或会话中断，保持原检查点，下次重读历史。

## 处理与回复

先用 `im +messages-mget --message-ids <原消息标识>` 获取完整内容、发送者、提及和回复关系；需要附件时用 `+messages-resources-download` 或读取命令的 `--download-resources`。查找成员与机器人可用 `+chat-members-list --page-all`，注意结果中的 `truncations`，不要猜测提及标识。非聊天操作直接查 `lark-cli <领域> --help` 或 `lark-cli skills read <领域>`，使用已确认身份执行。

回复前重新核对连接代次、原消息下已有回复和当前身份的 `OK` 反应。回复原消息使用：

```bash
lark-cli --profile <名称> im +messages-reply --as bot|user --message-id <原消息标识> --text '<内容>' --idempotency-key <稳定且不超过50字符的键>
```

图片、文件、视频和富文本直接使用该命令的 `--image`、`--file`、`--video`/`--video-cover`、`--markdown` 参数，先查看 `--help`；本地媒体路径必须相对于命令运行目录。幂等键由原消息标识和产物序号确定，同一产物重试必须复用原键；需要多条产物时各用不同序号，并确认总长度不超过 50 字符。回复关系通常会提醒原发送者；需要额外提及时先核实对象标识和上游内容格式。

确认回复成功后，给**原消息**添加 `OK` 反应：`lark-cli --profile <名称> im reactions create --as <身份> --message-id <原消息标识> --data '{"reaction_type":{"emoji_type":"OK"}}'`。未完成或回复失败时不添加。回复成功而反应失败时只补反应，不重发回复。发送超时或结果含糊时先重查原消息下的回复；仍无法确定是否发送成功则暂停自动重发并告知会话主人。不要仅凭有限时长的幂等键保证跨唤醒去重。无需回应的用户身份消息可以直接完成判断，不发送回复或反应。

## 持续响应与停止

用户要求持续响应时，活跃阶段继续有限时的检查。无人值守时，在当前 Codex 任务上建立心跳自动化，或在 Claude Code 会话中使用 `/loop` 定期唤醒**同一会话**；每次唤醒先读状态、补查历史，再根据当前绑定安排下一次。无变化时保持安静，只有新消息、失败、恢复或需要用户处理时报告。运行时无法唤醒时，说明中断和可能的消息空窗；恢复后从检查点补查。不要启动本仓库的常驻服务。

用户要求停止时，先撤销该会话的心跳或循环，再执行 `node <本技能目录>/scripts/session.mjs stop --session-id <标识> --generation <代次>`。旧会话收到 `STALE_SESSION` 时不得处理新聊天。检查点文件不保存凭据或消息正文；旧版配置也不由本技能读取、迁移或清理。
