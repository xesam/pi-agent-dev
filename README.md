# Pi Agent 入门到实战教程：从认识、使用到扩展，动手搭建一个多角色 Agent 团队

> 目标读者：第一次接触 AI Agent 的工程师。
> 读完这篇教程你会：
> 1. 理解「AI Agent」和「Agent Loop」到底是什么；
> 2. 能安装、配置、日常使用 Pi Agent（`@earendil-works/pi-coding-agent`）；
> 3. 掌握 Pi 的三种扩展方式：Extensions（工具/命令/事件）、Skills、Prompt Templates；
> 4. 从零搭建一个 **PM → Coder → Reviewer** 三角色协作的 Agent 产品。

参考资料：[Pi 官方仓库](https://github.com/earendil-works/pi) · [Pi 官方文档](https://pi.dev/docs/latest)

> **⚠️ 关于版本**：Pi 尚未发布稳定版（1.0 之前），**API 会变**。本教程的代码基于教程写作/维护时验证过的版本（迁移到 0.87 系的 `DefaultResourceLoader` 角色提示词模式）；你手上的版本可能更新。如果照着教程写代码时遇到"选项不存在"、"类型不匹配"这类报错，**以你本地安装包的类型定义为准**（不是教程、也不是网上任何文章），处理方法见[第 5 章开头](chapters/05-扩展Pi的三种方式.md)的"API 不稳定怎么办"。

---

## 章节目录

### 第一部分：基础（概念 + 使用）

| 编号 | 标题 | 文件 | 你会学到什么 |
|---|---|---|---|
| 第 1 章 | 什么是 AI Agent？ | [`chapters/01-什么是AI-Agent.md`](chapters/01-什么是AI-Agent.md) | Agent Loop 的核心概念 + 常见误解 + 动手验证 |
| 第 2 章 | 认识 Pi Agent | [`chapters/02-认识Pi-Agent.md`](chapters/02-认识Pi-Agent.md) | Pi 的设计哲学 + 与其他工具对比 + 适合场景 |
| 第 3 章 | 安装与第一次运行 | [`chapters/03-安装与第一次运行.md`](chapters/03-安装与第一次运行.md) | 安装、认证、第一次跑 + FAQ 排错 |
| 第 4 章 | 日常使用 | [`chapters/04-日常使用.md`](chapters/04-日常使用.md) | 界面操作、Slash 命令、非交互模式 + 动手练习 |

### 第二部分：动手扩展（从零到第一个 Extension）

| 编号 | 标题 | 文件 | 你会做什么 | 代码量 |
|---|---|---|---|---|
| 第 5 章 | 扩展 Pi 的三种方式 | [`chapters/05-扩展Pi的三种方式.md`](chapters/05-扩展Pi的三种方式.md) | 三种扩展机制的概览和 API 参考 | — |
| 第 5b 章 | 动手：第一个 Prompt Template | [`chapters/05b-动手第一个Prompt模板.md`](chapters/05b-动手第一个Prompt模板.md) | 创建 `/review`、`/commit` 模板 | 0 行 |
| 第 5c 章 | 动手：第一个 Skill | [`chapters/05c-动手第一个Skill.md`](chapters/05c-动手第一个Skill.md) | 创建编码规范 Skill，体验渐进式披露 | 0 行 |
| 第 5d 章 | 动手：第一个 Extension | [`chapters/05d-动手第一个Extension.md`](chapters/05d-动手第一个Extension.md) | 写自定义工具 + 事件拦截（两个 mini-lab） | ~20 行 |

### 第三部分：实战示例（从单角色到多角色到 SDK）

| 编号 | 标题 | 文件 | 你会做什么 | 代码量 |
|---|---|---|---|---|
| 第 6a 章 | 实战 Level-1：单角色 Subagent | [`chapters/06a-实战单角色Subagent.md`](chapters/06a-实战单角色Subagent.md) | 用 `createAgentSession` 创建只读审查员 | ~60 行 |
| 第 6b 章 | 实战 Level-2：安全编码守卫 | [`chapters/06b-实战安全编码守卫.md`](chapters/06b-实战安全编码守卫.md) | 路径保护 + 命令拦截 + 状态持久化 | ~80 行 |
| 第 6c 章 | 实战 Level-2.5：数据分析与报表生成 | [`chapters/06c-实战数据分析与报表.md`](chapters/06c-实战数据分析与报表.md) | 两 Agent 两次交接结构化产物；代码算数 + 模型判断 | ~300 行 |
| 第 6d 章 | 实战 Level-3：多角色 Agent 团队 | [`chapters/06d-实战多角色Agent团队.md`](chapters/06d-实战多角色Agent团队.md) | PM → Coder → Reviewer 三角色协作 | ~230 行 |
| 第 6e 章 | 实战 Level-4：用 SDK 嵌入 Pi | [`chapters/06e-实战SDK嵌入Pi.md`](chapters/06e-实战SDK嵌入Pi.md) | 把 Pi 嵌入 CI 代码审查脚本 | ~50 行 |
| 第 6f 章 | 调试与观测 | [`chapters/06f-调试与观测.md`](chapters/06f-调试与观测.md) | 观测 Leader/子 Agent 行为，隔离角色测试，排错路径 | — |

### 第四部分：进阶与参考

| 编号 | 标题 | 文件 | 内容 |
|---|---|---|---|
| 第 7 章 | 从 Demo 到真正产品 | [`chapters/07-从Demo到真正产品.md`](chapters/07-从Demo到真正产品.md) | 6 个扩展方向，每个带代码片段 |
| 第 7b 章 | 设计模式速查 | [`chapters/07b-设计模式速查.md`](chapters/07b-设计模式速查.md) | 从官方 50+ 示例提取的 8 个高频设计模式 |
| 附录 | 概念速查表、FAQ 与延伸阅读 | [`chapters/08-附录.md`](chapters/08-附录.md) | 概念图 + FAQ + 框架对比 + 官方示例索引 |

### 阅读路线建议

```
零基础读者：     Ch1 → Ch2 → Ch3 → Ch4 → Ch5b → Ch5c → Ch5d → Ch6a → (Ch6c)
有 Agent 经验：  Ch2 → Ch5 → Ch5d → Ch6a → Ch6c → Ch6d
想嵌入 Pi 到程序：Ch5 → Ch6e
想写安全扩展：   Ch5d → Ch6b → Ch7b
快速查阅：       直接看 附录（概念速查 + FAQ + 设计模式速查）
```

---

## 配套示例代码

| 目录 | 对应章节 | 说明 | 运行方式 |
|------|---------|------|---------|
| `examples/level-0-prompt-template/` | 第 5b 章 | Prompt Template 示例 | `cd` 进去 → `pi` → `/trust` → `/review` |
| `examples/level-0-skill/` | 第 5c 章 | Skill 示例 | `cd` 进去 → `pi` → `/trust` → `/reload` |
| `examples/level-1-single-subagent/` | 第 6a 章 | 单角色 Subagent | `cd` 进去 → `pi` → `/trust` → `/reload` |
| `examples/level-2-safe-coder/` | 第 6b 章 | 安全编码守卫 | `cd` 进去 → `pi` → `/trust` → `/reload` |
| `examples/level-2b-data-collector/` | 第 6c 章 | 数据分析与报表生成 | `cd` 进去 → `pi` → `/trust` → 对话描述分析要求 |
| `examples/level-3-multi-role/` | 第 6d 章 | 多角色团队 | `cd` 进去 → `pi` → `/trust` → `/team <需求>` |
| `examples/level-4-sdk-ci-reviewer/` | 第 6e 章 | SDK CI 审查脚本 | `npm install` → `node --experimental-strip-types ci-review.ts "<diff>"` |

---

## 示例复杂度阶梯

```
Level 0:  0 行代码   → 只写 .md 文件（模板/Skill）         → "扩展不一定要写代码"
Level 1: ~10 行     → 单个工具 or 单个拦截（Ch5d）         → "Extension 就这么简单"
Level 2: ~60 行     → 单角色 Subagent（Ch6a）              → "子 Agent = 独立会话"
Level 3: ~80 行     → 安全编码守卫（Ch6b）                  → "工具白名单 + 事件拦截 = 安全边界"
Level 3.5: ~300 行  → 数据分析与报表生成（Ch6c）            → "代码算数 + 模型判断"
Level 4: ~230 行    → 多角色团队（Ch6d）                    → "多角色协作 = Leader 调工具"
Level 5: ~50 行     → SDK 嵌入（Ch6e）                      → "Pi 不只是 CLI"
```
