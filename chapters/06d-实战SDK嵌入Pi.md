## 第 6d 章：实战 Level-4：用 SDK 嵌入 Pi

到目前为止，所有章节都是在 `pi` 的交互式 CLI 里使用 Pi。但 Pi 不只是 CLI——它提供了完整的 SDK，让你在自己的 Node.js 程序里创建 Agent 会话、驱动 Agent Loop、收集结果。

> **代码量**：约 50 行。读完本章你能把 Pi 嵌入 CI 脚本、自动化工具、Web 后端等任何 Node.js 场景。

### 6d.1 SDK 是什么

Pi 的 npm 包 `@earendil-works/pi-coding-agent` 同时导出了两层东西：

- **CLI 层**（你一直在用的）：`pi` 命令、交互式 TUI、Slash 命令……
- **SDK 层**（本章要用的）：`createAgentSession()` 等函数，让你在代码里直接创建和操控 Agent 会话

关键函数只有一个：

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  // 各种配置选项...
});
await session.prompt("你的任务");
session.dispose();
```

这跟 Ch6a/Ch6c 里在 Extension 内部用的 `createAgentSession` 是**同一个 API**——多角色扩展里创建子会话用的就是 SDK。区别只是：Extension 里你是被 Pi 调用的，而 SDK 里你是调用方。

### 6d.2 场景：CI 代码审查脚本

你的团队在代码合并前跑 CI。你想加一步：让 Agent 只读地审查 diff，输出一段结构化报告。

**为什么用 SDK 而不是 CLI**：

- SDK 可以在同一个 Node.js 进程里跑，不用 spawn 子进程
- SDK 可以拿到完整的消息对象（不只是文字输出），能解析工具调用、token 用量等
- SDK 可以嵌入现有的 CI 脚本，和测试/构建步骤无缝衔接

### 6d.3 代码

创建 `ci-review.ts`：

```typescript
/**
 * CI 代码审查脚本
 *
 * 用法：node ci-review.ts
 * 效果：读取 git diff，让只读 Agent 审查，输出报告到 stdout
 *
 * 需要：设置 ANTHROPIC_API_KEY 环境变量（或其他已配置的模型）
 */

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

async function main() {
  // 1. 初始化模型运行时（会自动读取 ~/.pi/agent/ 下的认证和模型配置）
  const modelRuntime = await ModelRuntime.create();

  // 2. 创建只读 Agent 会话
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),  // 不持久化，跑完就扔
    modelRuntime,
    tools: ["read", "grep", "find", "ls"],       // 只读——CI 审查员不能改代码
    systemPromptOverride: () => [
      "你是 CI 代码审查员。",
      "你会收到一个 git diff，需要审查以下方面：",
      "1. 明显的 Bug 和逻辑错误",
      "2. 安全漏洞（注入、XSS、敏感信息泄露）",
      "3. 错误处理是否完整",
      "4. 是否有遗漏的测试",
      "",
      "输出格式：",
      "- 总体评价（一段话）",
      "- 问题列表（按严重程度排序，标注文件名和行号）",
      "- 通过/不通过结论",
    ].join("\n"),
    appendSystemPromptOverride: () => [],         // 不追加默认 prompt
  });

  // 3. 订阅事件流——收集 Agent 的文字输出
  let output = "";
  let toolCallCount = 0;

  session.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
          output += event.assistantMessageEvent.delta;
        }
        break;
      case "tool_execution_start":
        toolCallCount++;
        console.error(`  [工具调用] ${event.toolName}`);
        break;
    }
  });

  // 4. 获取 git diff 并发送给 Agent
  // 在真实 CI 里这里用 execSync("git diff origin/main...HEAD") 等
  const diff = process.argv[2] ?? "请先 git add 你的改动，然后运行 git diff --cached";

  console.log("=== CI 代码审查开始 ===\n");
  await session.prompt(`审查以下 git diff：\n\n\`\`\`diff\n${diff}\n\`\`\``);

  // 5. 清理
  session.dispose();

  console.log("\n=== 审查完成 ===");
  console.log(`工具调用次数：${toolCallCount}`);

  // 6. 根据输出决定 CI 是否通过
  if (output.includes("不通过") || output.includes("严重问题")) {
    console.error("\n❌ 审查未通过");
    process.exit(1);
  } else {
    console.log("\n✅ 审查通过");
  }
}

main().catch((err) => {
  console.error("审查脚本出错：", err);
  process.exit(2);
});
```

### 6d.4 代码逐段解释

**① `ModelRuntime.create()`**

```typescript
const modelRuntime = await ModelRuntime.create();
```

这会读取 `~/.pi/agent/auth.json` 和 `~/.pi/agent/models.json`——跟你在 CLI 里 `/login` 存的认证是同一套。所以**你在 CLI 里登录过，SDK 就能用同一个模型**，不需要再配一遍 API Key。

**② `createAgentSession` 的关键选项**

```typescript
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),  // 内存会话，不写文件
  modelRuntime,
  tools: ["read", "grep", "find", "ls"],       // 只读工具集
  systemPromptOverride: () => "...",            // 自定义系统提示词
  appendSystemPromptOverride: () => [],         // 不追加默认内容
});
```

对比 Ch6a 里的用法——**完全一样**。因为 Extension 内部用的就是 SDK。

**③ 事件流**

```typescript
session.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
```

`subscribe` 是 Agent 的事件流。你能看到的不只是文字输出——还有工具调用（`tool_execution_start`）、消息生命周期（`message_start`/`message_end`）、agent 生命周期（`agent_start`/`agent_end`）等。SDK 文档有完整的事件列表。

**④ `session.prompt()`**

```typescript
await session.prompt("审查以下 git diff...");
```

这行代码会驱动整个 Agent Loop——模型决定调工具 → 执行 → 结果喂回 → 再决定——直到模型说完话。`await` 在 Agent 完全跑完后才 resolve。

**⑤ `session.dispose()`**

```typescript
session.dispose();
```

跟 Ch6a 一样，用完必须清理。

### 6d.5 运行

```bash
# 前提：已经在 pi CLI 里 /login 过，或设置了 API Key 环境变量
npm install @earendil-works/pi-coding-agent

# 方式一：直接传 diff 文本
node --experimental-strip-types ci-review.ts "$(git diff --cached)"

# 方式二：不传参数，让 Agent 自己用 bash 工具获取（但注意 tools 里没有 bash）
# 所以更好的方式是用外部获取 diff 再传入
```

> **注意**：上面的 `--experimental-strip-types` 是 Node.js 22+ 直接运行 TypeScript 的方式。如果你的 Node 版本较低，可以用 `tsx ci-review.ts` 或先 `tsc` 编译。

### 6d.6 SDK vs CLI：什么时候用哪个

| 维度 | CLI（`pi` 命令） | SDK（`createAgentSession`） |
|------|------------------|---------------------------|
| 适合场景 | 日常交互式编码 | 嵌入程序、CI、自动化 |
| 用户交互 | 有 TUI、确认框、输入框 | 无 UI——纯 API 调用 |
| 会话持久化 | 自动持久化到文件 | `SessionManager.inMemory()` 或自己管 |
| 模型配置 | 自动从 settings 读取 | 同样从 `~/.pi/agent/` 读取 |
| 扩展加载 | 自动从 `.pi/extensions/` 发现 | 可通过 `DefaultResourceLoader` 加载，也可不加 |
| 控制粒度 | 框架控制大部分 | 你控制一切 |

**简单原则**：需要人机交互 → CLI；需要嵌入程序 → SDK。

### 6d.7 进阶：加载扩展和 Skill

SDK 不只是"裸" Agent——你也可以加载项目里的扩展和 Skill：

```typescript
import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),  // 会自动发现 .pi/extensions、.pi/skills 等
});
await loader.reload();

const { session } = await createAgentSession({
  resourceLoader: loader,  // 传入加载器
  // ...其他选项
});
```

这样你在 SDK 里也能用项目里定义的扩展工具和 Skill——跟在 CLI 里完全一样。

### 6d.8 从这里到下一步

```
Ch6a（Extension 内用 SDK）   → 被 Pi 调用
Ch6b（安全守卫）             → 纯 Extension，不涉及 SDK
Ch6c（多角色团队）           → Extension 内用 SDK 创建多个子会话
Ch6d（SDK 嵌入）             → 你自己调用 SDK          ← 本章
```

Ch6c 和 Ch6d 是同一套 API 的两种用法：在 Extension 里用（Ch6c），和在自己程序里用（Ch6d）。理解了这一层，你就完全掌握了 Pi 的扩展生态。

---

← [上一章：第 6c 章 实战 Level-3：多角色 Agent 团队](06c-实战多角色Agent团队.md) ｜ [下一章：第 6e 章 调试与观测](06e-调试与观测.md) →
