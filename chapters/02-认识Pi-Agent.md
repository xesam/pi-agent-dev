## 第 2 章：认识 Pi Agent

### 2.1 它是什么

[Pi](https://github.com/earendil-works/pi)（完整包名 `@earendil-works/pi-coding-agent`）是一个开源、MIT 协议、**不绑定任何单一模型厂商**的编程 Agent 命令行工具。它由几个分层的 npm 包组成：

| 包 | 作用 |
|---|---|
| `@earendil-works/pi-ai` | 统一的多厂商 LLM API（Anthropic、OpenAI、Google、DeepSeek、Bedrock 等 20+ 家） |
| `@earendil-works/pi-agent-core` | Agent Loop 的核心运行时：工具调用 + 状态管理 |
| `@earendil-works/pi-coding-agent` | 面向"写代码"场景的完整 Agent CLI：内置工具、会话持久化、扩展系统 |
| `@earendil-works/pi-tui` | 终端 UI 库（差分渲染），给 CLI 界面用 |

你平时直接接触的就是最上层的 `pi-coding-agent`，也就是敲 `pi` 这个命令。

**一句话建立心智模型**：Pi 就是一个跑在你终端里的 REPL。你打一句话，它不像 ChatGPT 那样直接回答，而是会自己调用工具去翻文件、跑命令、改代码，把活干完再回来跟你汇报。你之前调 LLM API 是“拼 messages → 一次调用 → 拿文字”，Pi 帮你把第 1 章讲的那个循环（调工具 → 喂回结果 → 再调）全自动跑起来了——你只管给任务，循环它来转。

### 2.2 核心设计哲学

Pi 的 README 里有一句话很关键："**保持核心极小，把工作流相关的行为都推到扩展、Skills、Prompt Templates 和 Packages 里去。**"

具体表现是，下面这些“别家 Agent 常见的内置能力”，Pi 全都**默认不内置**，而是留给你按需用扩展加上：

- **MCP**（Model Context Protocol，把外部数据源/工具接给模型用的标准协议）——不做，你想接自己装 MCP 扩展。
- **Sub-agent / 多 Agent 编排**——不做，本教程第 6 章就是教你用 `createAgentSession` 自己搭一个。
- **权限弹窗系统**（每次危险操作停下来问你）——不做，想加用 `tool_call` 事件拦截（第 5.3 节有例子）。
- **Plan 模式 / Todo 列表**——不做，这类工作流交给 prompt 和 skill。
- **后台 Bash**——不做，`bash` 就是前台同步跑。

注意这些都不是“没有”，而是“刻意不放进核心”。这正是本教程第 6 章要做的事——我们会亲手给 Pi 加上“多角色协作”的能力，恰好补上列表里的第 2 项。

Pi 默认内置的东西非常朴素，只有四个工具：`read`（读文件）、`write`（写文件/新建文件）、`edit`（改文件）、`bash`（跑命令），外加几个只读辅助工具 `grep`、`find`、`ls`。

### 2.3 权限模型：没有沙箱，靠你自己控制

一个很重要、容易被忽略的事实：**Pi 默认没有权限确认弹窗**，它以启动它的用户/进程权限直接运行，`bash` 工具可以执行任何命令。如果你想要隔离，官方提供了三种思路（micro-VM 的 Gondolin 扩展、普通 Docker、策略化沙箱 OpenShell），但都需要你自己接入。

> 对第一次用 Agent 的程序员的建议：先在一个你不怕搞坏的、已经用 git 管理的目录里练习，改动前 `git status` 一下，改坏了随时 `git checkout` 回滚。

### 2.4 Pi 和其他工具对比

如果你已经用过其他 AI 编码工具，这张表帮你快速定位 Pi 的位置：

| 维度 | Pi | Claude Code | Cursor | Aider | LangChain Agent |
|------|----|----|--------|-------|-----------------|
| 形态 | CLI | CLI | IDE 插件 | CLI | 库 |
| 模型绑定 | 不绑定 | 仅 Anthropic | 多模型 | 多模型 | 不绑定 |
| 扩展机制 | Extension / Skill / Prompt | MCP | 配置 | 配置 | 纯代码 |
| 子 Agent | 扩展实现 | 内置 | 无 | 无 | 代码实现 |
| 权限模型 | 用户权限（靠扩展加沙箱） | 内置确认 | IDE 权限 | 用户权限 | 开发者控制 |
| 会话管理 | 树状分支/fork/clone | 线性 | 无 | git 块 | 开发者控制 |
| 适合场景 | CLI 编码、CI 自动化、自定义工作流 | Anthropic 生态编码 | IDE 内编码 | git 工作流编码 | 嵌入应用 |

**一句话区分**：Cursor 和 Claude Code 是"开箱即用"的产品；Pi 是"给你积木让你搭"的框架——核心极小，能力靠扩展加。

### 2.5 Pi 适合 / 不适合什么场景

**适合**：
- 终端里的日常编码——读代码、改代码、跑测试
- CI/CD 自动化——用 SDK 把 Agent 嵌入流水线
- 自定义工作流——多角色协作、代码审查、文档生成
- 需要灵活切换模型的场景

**不适合**：
- 需要 IDE 集成和可视化调试的 → 用 Cursor
- 只用 Anthropic 模型且不想配置的 → 用 Claude Code
- 需要图形界面交互的 → Pi 是 CLI 工具
- 不愿意写任何代码就想获得全部能力的 → Pi 的核心很小，你得自己加扩展

---

← [上一章：第 1 章 什么是 AI Agent？](01-什么是AI-Agent.md) ｜ [下一章：第 3 章 安装与第一次运行](03-安装与第一次运行.md) →
