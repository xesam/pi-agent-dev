## 第 5c 章：动手——你的第一个 Skill

上一章你用 10 分钟创建了 Prompt Template——零代码，就是一个 `.md` 文件。这一章再进一步，创建一个 Skill：仍然不需要写 TypeScript，但比模板多了一层"按需加载"的智能。

> **预计时间**：15 分钟。

### 5c.1 场景：让 Pi 自动遵循编码规范

你的团队有一份编码规范（命名约定、错误处理方式、注释风格等）。你希望 Pi 在写代码时自动遵循，但又不想每次对话都把整份规范贴进去——那会浪费大量 context。

Skill 的解决方案叫**渐进式披露**：启动时只把 Skill 的"名字 + 一句话描述"塞进系统提示词（几十个 token），模型觉得任务匹配时才去读完整内容（可能几千 token）。这样装几十个 Skill 也不会把上下文塞爆。

### 5c.2 动手：创建 `code-style-guide` Skill

**第 1 步**：在项目目录下创建目录结构：

```
你的项目/
└── .pi/
    └── skills/
        └── code-style-guide/
            ├── SKILL.md
            └── scripts/
                └── check-style.sh
```

**第 2 步**：在 `SKILL.md` 里写入：

```markdown
---
name: code-style-guide
description: 团队编码规范。在编写或修改 TypeScript 代码时使用，确保命名、错误处理和注释风格符合团队约定。
---

# 团队编码规范

## 命名约定
- 变量和函数：camelCase（如 `getUserById`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_RETRY_COUNT`）
- 类型/接口：PascalCase（如 `UserProfile`）
- 私有成员以下划线开头（如 `_internalState`）

## 错误处理
- 不允许裸 `throw`，必须 throw 自定义错误类或 `Error` 子类
- async 函数必须 try-catch 并返回统一错误格式
- 禁止吞掉错误（空 catch 块）

## 注释风格
- 公共函数必须有 JSDoc 注释
- 注释解释"为什么"，不解释"是什么"
- TODO 注释必须带日期和负责人：`// TODO(2024-01-15, zhang): ...`

## 使用风格检查脚本
在提交前运行检查：
\`\`\`bash
./scripts/check-style.sh src/
\`\`\`
脚本会扫描常见风格问题并输出报告。
```

**注意 frontmatter 里的 `description`**——这是整条 Skill 最关键的字段。模型就是看它来决定"现在这个任务要不要去读完整的 SKILL.md"。写得好模型就会在写代码时自动加载它，写得差模型就会忽略它。

**好的 description**：
> 在编写或修改 TypeScript 代码时使用，确保命名、错误处理和注释风格符合团队约定。

**差的 description**：
> 编码规范。

差别在于：好的 description 说了**什么时候用**（写 TypeScript 代码时）和**用来干什么**（确保风格一致）。

**第 3 步**：创建检查脚本 `scripts/check-style.sh`：

```bash
#!/bin/bash
# 简单的风格检查脚本
DIR="${1:-src}"
echo "扫描 $DIR ..."
grep -rn "console\.log" "$DIR" 2>/dev/null && echo "⚠️  发现 console.log"
grep -rn "TODO" "$DIR" 2>/dev/null | grep -v "TODO(" && echo "⚠️  发现未标记负责人的 TODO"
echo "检查完成。"
```

```bash
chmod +x scripts/check-style.sh
```

**第 4 步**：测试。

```bash
cd 你的项目目录
pi
/trust
/reload
```

现在跟 Pi 说：

```
帮我写一个获取用户信息的函数 fetchUser
```

观察模型的行为——它可能会先 `read` 一下 `SKILL.md`（渐进式披露的体现），然后按照规范写代码。如果你发现模型没有自动加载 Skill，可以用 `/skill:code-style-guide` 强制触发。

### 5c.3 对比实验：Skill vs AGENTS.md

做一个对比来理解"渐进式披露"的价值：

**方案 A**：把编码规范的完整内容写进 `AGENTS.md`。
→ Pi 每次启动都会把整份规范塞进系统提示词。即使你只是问"今天天气怎么样"，这几千 token 也一直在占用 context。

**方案 B**：把编码规范做成 Skill（你刚才做的）。
→ Pi 启动时只看 Skill 的 description（几十 token）。只有当任务涉及写代码时，模型才去读完整内容。

| 维度 | AGENTS.md（方案 A） | Skill（方案 B） |
|------|---------------------|-----------------|
| 何时加载 | 每次启动，常驻 | 模型觉得相关时才读 |
| context 占用 | 一直占用 | 按需占用，不用就不占 |
| 适合放什么 | 一定要遵守的全局规则 | 可能用到、也可能用不到的专业知识 |
| 风险 | 太多内容会撑爆 context | 模型可能不触发（可以 `/skill:` 强制） |

**选型原则**：如果某条规则每次对话都要遵守，放 AGENTS.md；如果只在特定任务才需要，放 Skill。

### 5c.4 进阶练习

**练习 1**：给 Skill 加一个 `references/` 目录，放详细规范文档，在 SKILL.md 里用相对路径引用：

```
code-style-guide/
├── SKILL.md
├── scripts/
│   └── check-style.sh
└── references/
    └── api-conventions.md    ← 详细的 API 设计规范
```

在 SKILL.md 里加一句：
```markdown
详细的 API 设计规范见 [references/api-conventions.md](references/api-conventions.md)。
```

模型会按需去读这个参考文件——这就是"渐进式披露"的延伸：SKILL.md 是入口，references 是展开。

**练习 2**：创建一个 `git-workflow` Skill，教模型你们团队的 Git 分支策略和 PR 流程。

### 5c.5 Skill 存放位置

| 位置 | 作用域 |
|------|--------|
| `~/.pi/agent/skills/` | 全局（所有项目） |
| `.pi/skills/` | 项目级（需先 `/trust`） |

Pi 还支持从其他 Agent 工具（Claude Code、OpenAI Codex）的 Skill 目录加载——在 settings 里配：

```json
{
  "skills": ["~/.claude/skills", "~/.codex/skills"]
}
```

### 5c.6 Skill 和 Prompt Template 怎么选？

| 问题 | 用 Prompt Template | 用 Skill |
|------|-------------------|---------|
| 需要参数化吗？ | ✅ 支持 `$1`/`$@` | ❌ 只能用 `/skill:name 参数` 追加 |
| 需要附带脚本吗？ | ❌ | ✅ 可以放 `scripts/` |
| 需要参考文档吗？ | ❌ | ✅ 可以放 `references/` |
| 需要模型自动触发吗？ | ❌ 只能手动 `/` 调用 | ✅ 模型根据 description 自动判断 |
| 实现成本 | 最低（一个 .md） | 低（一个目录） |

**简单记法**：Template 是"快捷短语"，Skill 是"操作手册"。

### 5c.7 本章要点

- Skill = 带入口文件 `SKILL.md` 的目录，模型**按需**读取完整内容
- frontmatter 的 `description` 是"触发器"——写得好模型才用，写得差模型会忽略
- 渐进式披露 = 启动时只加载 description，任务匹配才读正文——节省 context
- 附带 `scripts/` 和 `references/` 让 Skill 成为真正的"操作手册"
- **能用 Skill 解决的，别急着写 Extension**——下一章才是 Extension

---

← [上一章：第 5b 章 动手——你的第一个 Prompt Template](05b-动手第一个Prompt模板.md) ｜ [下一章：第 5d 章 动手——你的第一个 Extension](05d-动手第一个Extension.md) →
