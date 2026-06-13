# Validation Contract — CLI App Setup (验收契约 — CLI 应用配置)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| setup 与配置文件 | VAL-CLI-001 ~ VAL-CLI-003 |
| 配置读取 | VAL-CLI-004 ~ VAL-CLI-005 |
| 调试入口与文档 | VAL-CLI-006 ~ VAL-CLI-007 |

## Toolchain (本仓库验证栈)

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| unit-test | `node:test` |
| e2e-cli | `node:test` 通过子进程或 `main()` 调用验证 CLI 行为 |
| repo-check | `rg` 内容检查 |

## Assertions (断言)

### VAL-CLI-001
- **Behavior (行为)**: `setup` 不带参数时输出引导，不要求立即提供应用凭据。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: CLI 输出包含飞书开发者后台入口和带 `--app-id`、`--app-secret` 的 setup 示例。

### VAL-CLI-002
- **Behavior (行为)**: `setup --app-id --app-secret` 保存应用级配置，但不保存群聊 ID。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 后续配置状态能读到应用 ID 和密钥已配置，且没有群聊字段。

### VAL-CLI-003
- **Behavior (行为)**: `setup` 明确拒绝 `--chat-id`。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 命令返回错误，配置文件不记录群聊 ID。

### VAL-CLI-004
- **Behavior (行为)**: 配置解析按显式参数、环境变量、本地配置、默认值的顺序读取。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 单元测试覆盖各层优先级，且本地配置低于环境变量和显式参数。

### VAL-CLI-005
- **Behavior (行为)**: `doctor` 和 `daemon start` 在未传应用凭据时可以使用本地配置。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: CLI 测试观察到传入 live doctor 或 daemon 的配置来自本地配置。

### VAL-CLI-006
- **Behavior (行为)**: 一次性监听作为调试入口保留，正式主流程仍指向 daemon 加 MCP。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: CLI 测试可以通过调试入口触发一次性监听，帮助文本包含调试入口。

### VAL-CLI-007
- **Behavior (行为)**: README 和 agent setup 文档不再把 `chatId` 描述为应用 setup 的一部分。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 文档中 setup 示例只包含应用 ID 和应用密钥；群聊出现在绑定步骤中。
