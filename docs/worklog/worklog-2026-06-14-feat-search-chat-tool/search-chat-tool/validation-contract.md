# Validation Contract — Search chat tool (验收契约 — 聊天搜索工具)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 聊天搜索工具 | VAL-CHAT-001 ~ VAL-CHAT-004 |
| 技能改名和打包 | VAL-SKIL-001 ~ VAL-SKIL-002 |
| 单聊绑定支持 | VAL-DM-001 ~ VAL-DM-002 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| unit-test | `node:test` |
| integration-test | `node:test`，通过本地 HTTP daemon 和 MCP handler 测试跨模块行为 |
| repo-check | `rg` 和 `git diff --check` |
| build | `npm run build` 与 `npm pack --dry-run` |
| manual | 飞书真实群和机器人单聊人工验证 |

## Assertions (断言)

### VAL-CHAT-001
- **Behavior (行为)**: MCP 工具列表包含聊天搜索工具，且不需要先绑定会话。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: MCP 工具列表包含新的搜索工具名；调用该工具会转发到本地 daemon 的搜索入口，而不是要求 `agentSessionId`。

### VAL-CHAT-002
- **Behavior (行为)**: 搜索工具能按关键词返回机器人可见群聊候选项。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 给定模拟飞书搜索响应，返回结果包含 `chatId`、`name`、`description`、`chatMode`、`memberCount` 等归一化字段。

### VAL-CHAT-003
- **Behavior (行为)**: 搜索结果为空时，工具返回空列表和可操作提示。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 空搜索响应里包含提示用户确认群名、创建群或把机器人拉入群后重试的文本。

### VAL-CHAT-004
- **Behavior (行为)**: 飞书搜索失败时，MCP 工具返回结构化错误，不静默吞掉失败。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: daemon 搜索客户端抛错时，MCP 返回 `isError: true`，payload 中包含错误 code 和 message。

### VAL-SKIL-001
- **Behavior (行为)**: 插件主响应技能改名为 `lark-connect`，Codex 专属展示名也保持英文原始技能名。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 插件技能目录、`SKILL.md` frontmatter 和 `agents/openai.yaml` 都使用 `lark-connect`；旧技能名不再作为主技能出现。

### VAL-SKIL-002
- **Behavior (行为)**: 技能说明在绑定前优先搜索群聊；找不到时提示创建群或把机器人拉入群。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文包含搜索工具使用流程和找不到群时的用户提示规则。

### VAL-DM-001
- **Behavior (行为)**: 已绑定的单聊消息即使没有提及机器人，也能进入对应智能体会话队列。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 构造 `chatType: "p2p"` 且 `mentionedBot: false` 的消息后，绑定会话能够 poll 到该消息。

### VAL-DM-002
- **Behavior (行为)**: 群聊消息仍然必须明确提及机器人，普通群消息不会进入队列。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 既有普通群消息测试继续通过，并断言 `mentionedBot: false` 的群消息不会被路由。
