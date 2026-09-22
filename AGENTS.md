<!-- AURIGA:WORKFLOW:v1 START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->
# auriga 工作流 (v1.22.0)

1. 需求澄清：新增或改变外部可见行为时，先用 `spec-design` 基于实际代码与产品事实判断价值并对齐目标。**spec = why + 用户可观察的 what；arch design = 系统结构的 how；plan = 实施步骤**。外部行为不变时可以跳过需求规格，但仍可能需要架构澄清。

2. 架构与计划：技术方案不显然、需要重划边界、优化架构或澄清领域模型时使用 `arch-design`；实质性设计必须在实现前取得用户确认。需要计划时，在进入实现前让用户从内置 Plan 与 `planning-with-files` 中二选一；`goalify` 是可与任一计划载体组合的自主执行模式，只在用户明确选择时启用。

3. Git 生命周期：写码前从仓库约定的基准分支建立任务分支，禁止直接提交基准分支。命名前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。所有 git/gh 操作走 `git-workflow`，首个有意义提交后尽早创建 Draft PR。

4. 测试与缺陷：新增行为、缺陷修复和重构都按 `test-driven-development` 建立有意义的失败证据或行为保护网；其中缺陷在进入修复实现前，先用 `systematic-debugging` 建立证据并确认根因。

5. 增量实现：非平凡实现使用 `incremental-impl` 先拆成完整、可验证、可集成的实施单元，再按依赖增量落地。

6. 验证后再说完成：任何“已完成、已修复、通过或可评审”的判断，都必须基于最后一次相关修改之后、与该判断匹配的验证结果；证据不足时如实说明缺口。

7. PR 就绪：按 `git-workflow` 完成验证和拉取请求整理后才标 Ready。当前 PR 的设计产物（spec.md、task_plan.md 等）用 `AskUserQuestion` / `request_user_input` 问用户：删除还是归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<分支名>/`；选定后的删除、归档或晋升用 `documentation-management` 执行，不直接移动文件。跨多个 PR 的总规范可保留在 `docs/long-running-specs/`，不受 Ready 清理门禁影响；全部子 PR 结束后由人工决定归档。

8. PR 评审：Ready 后，没有持续集成评审（CI Review）的项目必须在本地运行 `deep-review`；已有持续集成评审时，由用户决定是否还需要本地评审。具体路由、输出和重跑授权由该技能负责。

## 快速开发流程（缺陷修复 / 小重构 / 小功能）

当任务只有一个单一明确结果、没有未决的产品或架构决定、不需要跨会话跟踪，也不需要拆成多个完整实施单元时，可以跳过计划载体选择并直接进入实现。否则在实现前选择内置 Plan 或 `planning-with-files`。快速流程不跳过适用的需求澄清、架构确认、测试、验证和评审。

## 文档规范

仓库文档统一放 `docs/` 下，按用途分目录：

| 目录 | 用途 | 生命周期 |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | 已归档的 spec / planning / 架构产物；一个 PR 一个子目录 | 永久 |
| `docs/rules/` | 编码规范、review checklist、命名约定 | 长期 |
| `docs/rules/review/` | 项目自定义 reviewer；`reviewer-creator` 创建，`deep-review` 自动发现分派 | 长期 |
| `docs/rules/test/` | 项目测试规则；`test-driven-development` 在写测试前读取 | 长期 |
| `docs/rules/spec/` | 项目 spec 规则；`spec-design` 调研阶段必读 | 长期 |
| `docs/rules/arch/` | 项目架构设计规范；`arch-design` 作为设计硬约束 | 长期 |
| `docs/specs/` | `spec-design` / `arch-design` 输出默认归宿，开发期临时工作区。**PR Ready 前必须清空**：晋升到 `docs/architecture/`、归档到 worklog、或删除 | 开发期 |
| `docs/long-running-specs/` | 跨多个 PR 的总规范、共同约束、切片顺序和状态矩阵；当前 PR 的独立验收契约仍放 `docs/specs/` | 跨 PR；全部子 PR 结束后人工归档 |
| `docs/architecture/` | 稳定设计文档 + ADR（`ADR-<序号>-<标题>.md`） | 长期 |

## 运行框架原则

- **约束靠机制执行，不靠提示词**：核心规则尽量用 linter / CI / 类型系统 / hook 执行。
- **仓库保存长期事实**：需要跨会话使用的当前事实、计划和设计决定必须存在于 Agent 可访问的版本化资产中。
- **持续对抗熵增**：处理评审发现时，在不扩大当前改动范围的前提下，持续偿还确定、低风险的小额技术债务。
- **上下文分层，按需加载**：规则写在它实际约束的作用域里，根 `AGENTS.md` 只放全局规则和索引。子包或有独立工具链、独立约定的目录维护自己的 `AGENTS.md`，并配 `CLAUDE.md -> AGENTS.md` 兼容软链。运行时对子作用域指令的自动加载范围并不一致，所以下沉的内容必须同时由上层 `AGENTS.md` 单行索引指向，不能假设它一定会被自动读取。分层判据见 `documentation-management`。

## Agent 分发原则

- 简单明确的任务由当前 Agent 完成；相互独立的只读工作优先使用运行时内置子代理。
- 多个写入者由 `incremental-impl` 明确文件所有权、依赖、集成顺序和隔离方式；并行写使用独立工作树或完全不重叠的目录。
- 只有用户明确要求独立进程，或任务确实需要跨模型、零污染的新视角时，才使用外部 Agent。
- 派遣时明确结果目标、范围、验证方式和输出要求；模型与推理强度按任务风险选择，并在运行时支持时覆盖。

<!-- AURIGA:WORKFLOW:v1 END sha256=8765e5fbf26c1bd8 -->

<!-- 在下方添加你的工程专属规则。上方受管区块由 auriga-cli 维护,升级时整块替换;此处内容会被保留。 -->

# lark-connect 开发规范

## 项目边界

- 这是 Node.js ECMAScript Module（ECMAScript 模块）项目，运行时要求 Node.js 22 或更新版本。不要引入构建步骤或转译层，除非有明确收益。
- 正式飞书操作使用官方 `lark-cli`；本仓库只提供 Codex 和 Claude Code 共用的技能，以及保存单连接和扫描位置的本机脚本。不要重新包装飞书读写接口或增加守护进程、模型上下文协议服务。
- 仓库根目录不提交 `.mcp.json` 或 `.codex/config.toml`。正式入口是 `plugins/lark-connect/` 中的双运行时技能载荷。

## 配置和安全

- 用户自行通过 `lark-cli` 引导创建配置档案及授权；插件不读取、迁移或删除旧版凭据。不要把应用密钥或令牌写入测试、插件、文档或 PR。
- 当前同一时间只允许一个聊天和一个智能体会话绑定。会话脚本只保存配置档案名、身份、聊天标识、会话标识、连接代次和扫描位置，不保存聊天正文或逐消息账本。
- 所有飞书命令必须显式指定配置档案及机器人或用户身份；身份访问失败时不得静默切换。改变单连接约束须先写清需求和迁移策略。

## 代码和测试

- 会话脚本行为变化同步更新 `tests/session.test.mjs`；插件载荷或市场清单变化同步检查 `tests/plugin-packaging.test.mjs`。
- 修改用户可见安装、配置、等待或聊天消息处理流程时，同步更新 `README.md` 和相关 skill。
- 涉及真实飞书消息链路的变更，用明确指定的测试聊天和身份做端到端验证：连接、消息发现、原消息回复、完成反应、空窗补查与停止。验证记录只写通用步骤和结论，不写私人聊天或凭据信息。
- 纯文档改动至少运行 `git diff --check` 并检查过时命令。代码改动至少运行相关 `node --test ...` 与 `npm run build`；发布前运行 `npm run quality`。

## 插件和发布

- 插件是 Codex 和 Claude Code 两用载荷。改技能或插件描述时，要同时检查 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.agents/plugins/marketplace.json` 和 `.claude-plugin/marketplace.json` 是否需要同步。
- Codex 专属 `agents/openai.yaml` 里的 `display_name` 保持英文原始技能名，不要改成中文展示名。
- 只要插件用户可见能力发生变化，就要评估插件 manifest 版本和市场描述是否需要更新。
- 本仓库为私有开发包；版本 tag 触发插件的 GitHub Release，不再发布 npm 包。
