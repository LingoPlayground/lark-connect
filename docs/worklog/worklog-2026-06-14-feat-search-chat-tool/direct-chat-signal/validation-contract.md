# Direct Chat Signal Validation Contract

## Toolchain

| Tool | Observed command |
|---|---|
| unit-test | `node --test tests/daemon-runtime.test.mjs` |
| integration-test | `node --test tests/daemon-http.test.mjs tests/mcp-daemon.test.mjs` |
| build | `npm run build` |
| repo-check | `git diff --check` |

## Assertions

### VAL-DM-001

Behavior: 当智能体等待指定挑战文本时，未绑定 P2P 单聊中精确匹配挑战文本的消息会返回该单聊的 `chatId` 和建议绑定参数。

Tool: unit-test

Evidence: 构造未绑定 P2P 消息，内容与 `challengeText` 修剪后相同，等待调用返回 `signal.bindingInput.chatId`。

### VAL-DM-002

Behavior: 群聊消息、未绑定 P2P 中不匹配挑战文本的消息、已绑定 P2P 消息都不能完成单聊发现。

Tool: unit-test

Evidence: 分别构造上述消息，等待调用不返回发现结果；已绑定 P2P 仍进入既有消息队列。

### VAL-DM-003

Behavior: 如果用户发送挑战文本早于等待调用，daemon 能从短期内存缓冲中匹配到这条未绑定 P2P 消息。

Tool: unit-test

Evidence: 先投递未绑定 P2P 挑战消息，再以 `timeoutMs: 0` 等待，仍返回对应 `chatId`。

### VAL-DM-004

Behavior: MCP 工具把等待单聊挑战的参数原样转发给本地 daemon，并把 daemon 返回的 `signal` 作为工具结果返回。

Tool: integration-test

Evidence: 注入本地 daemon 客户端，调用 `lark_connect_wait_direct_chat_signal`，断言参数和工具返回内容。

### VAL-DM-005

Behavior: 无效等待请求以 `INVALID_REQUEST` 返回，不会被包装成飞书接口失败。

Tool: integration-test

Evidence: 通过本地 HTTP 客户端发送空挑战文本或非对象请求体，断言 HTTP 状态为 400 且错误码为 `INVALID_REQUEST`。
