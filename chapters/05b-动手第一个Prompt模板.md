## 第 5b 章：动手——你的第一个 Prompt Template

前一章介绍了 Pi 的三种扩展方式。现在从最简单的开始——Prompt Template，它不需要写一行代码，只要创建一个 `.md` 文件。

> **预计时间**：10 分钟。你只需要一个文本编辑器和已经装好的 `pi`。

### 5b.1 场景：把重复的指令存成模板

你经常让 Pi 审查代码改动，每次都要打：

```
审查 git diff --cached 里的改动，重点关注 bug、安全问题、错误处理……
```

打多了就烦。Prompt Template 就是让你把这段话存成一个文件，以后只要 `/review` 就行。

### 5b.2 动手：创建 `/review` 模板

**第 1 步**：在你的项目目录下创建目录和文件：

```
你的项目/
└── .pi/
    └── prompts/
        └── review.md
```

**第 2 步**：在 `review.md` 里写入以下内容：

```markdown
---
description: 审查当前 staged 的改动
argument-hint: "[关注点]"
---
审查 `git diff --cached` 里的改动，重点关注：
- Bug 和逻辑错误
- 安全问题
- 错误处理是否完整

额外关注点：${1:-无}
```

**注意文件开头的 `---` 块**——这叫 frontmatter，`description` 告诉 Pi 这个模板是干什么的，`argument-hint` 是你在输入 `/review` 时看到的参数提示。

**最后一行的 `${1:-无}` 是参数变量**：`$1` 取你传的第一个参数，没传就用默认值"无"。所以 `/review 性能` 会把"性能"填进去，而只打 `/review` 就填"无"。

**第 3 步**：测试。

```bash
cd 你的项目目录
pi
/trust        # 首次需要信任项目
/reload       # 让 Pi 重新加载模板
```

现在输入 `/review`，你会看到模板内容被展开成了完整的指令发给模型。再试试 `/review 性能`，观察"性能"被填进了"额外关注点"。

> **提示**：如果 `/review` 没有出现在自动补全里，先 `/reload` 刷新一下。

### 5b.3 进阶练习

#### 练习 1：创建 `/commit` 模板

创建 `.pi/prompts/commit.md`：

```markdown
---
description: 按 Conventional Commits 格式生成 commit message
---
看一下 `git diff --cached` 的改动，生成一条符合 Conventional Commits 规范的 commit message。

格式要求：
- 类型前缀：feat / fix / docs / refactor / test / chore
- 简短描述不超过 50 字符
- 如果改动较大，空一行后写正文说明

只输出 commit message 本身，不要加多余的格式化标记。
```

用法：`/commit`

#### 练习 2：创建 `/refactor` 模板

创建 `.pi/prompts/refactor.md`：

```markdown
---
description: 重构指定文件或代码段
argument-hint: "<文件路径> [目标]"
---
对 `$1` 进行重构，目标：${2:-可读性和可维护性}。

要求：
- 保持外部行为不变（不改变函数签名和输出）
- 每次只做一个改动，改完先跑测试确认没坏
- 如果改动幅度大，先告诉我你打算怎么改，等我确认再动手
```

用法：`/refactor src/utils.ts` 或 `/refactor src/utils.ts 提取公共逻辑`

### 5b.4 参数变量语法速查

| 语法 | 含义 | 示例 |
|------|------|------|
| `$1`、`$2` …… | 按位置取第 N 个参数 | `/refactor src/utils.ts 性能` → `$1`=`src/utils.ts`，`$2`=`性能` |
| `$@` / `$ARGUMENTS` | 取全部参数（合成一个字符串） | `/review 性能 安全 风格` → `$@`=`性能 安全 风格` |
| `${1:-默认值}` | 有参数用参数，没参数用默认值 | `/review` → `${1:-无}`=`无`；`/review 性能` → `性能` |

### 5b.5 存放位置

| 位置 | 作用域 | 说明 |
|------|--------|------|
| `~/.pi/agent/prompts/*.md` | 全局（所有项目） | 你个人常用的模板 |
| `.pi/prompts/*.md` | 项目级（需先 `/trust`） | 跟项目绑定的模板，可以提交到 Git 跟团队共享 |

> **注意**：Pi 不递归扫描子目录。`prompts/sub-dir/xxx.md` 不会被自动发现——子目录模板要在 settings 里显式声明。

### 5b.6 什么时候用 Prompt Template？什么时候不用？

**适合用模板的场景**：
- 你发现自己反复打同一段指令——存成模板
- 团队有固定的代码审查 / 提交规范——存成模板，提交到 Git
- 不同场景只需要微调几个词——用 `$1` 参数化

**不适合用模板的场景**：
- 指令需要根据上下文动态变化——那是 Skill 的工作（下一章）
- 需要给模型新增一个"动作"——那是 Extension 的工作（Ch5d）
- 只用一次的指令——直接打就行，不用存模板

### 5b.7 本章要点

- Prompt Template = 存成 `.md` 的常用指令，`/文件名` 触发
- 零代码、零风险——写错了顶多是模型回错话，不会搞坏系统
- frontmatter 里的 `description` 和参数变量是两个关键功能
- 这是 Pi 三种扩展方式里成本最低的——**能用模板解决的，别用 Skill 和 Extension**

---

← [上一章：第 5 章 扩展 Pi 的三种方式](05-扩展Pi的三种方式.md) ｜ [下一章：第 5c 章 动手——你的第一个 Skill](05c-动手第一个Skill.md) →
