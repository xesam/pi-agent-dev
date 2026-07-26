## 第 6a 章：实战 Level-1：单角色 Subagent

你已经会写简单的 Extension 了（上一章的两个 mini-lab）。现在更进一步——用 `createAgentSession` 创建一个**独立的子 Agent 会话**，让它扮演"代码审查员"的角色。

这是 Ch6c 多角色团队的基础。但在这一章里，我们只做**一个角色**，不做编排循环，不做熔断——先把"子 Agent = 独立会话"这个核心概念消化掉。

> **代码量**：约 60 行。读完本章你能在 30 分钟内亲手跑通一个"写完代码 → 自动叫审查员检查 → 汇报"的流程。

### 6a.1 我们要做什么

```
你跟 Pi 说一个需求
   ↓
Pi（Leader）自己写代码完成需求
   ↓
Pi 调用 delegate_to_reviewer 工具
   ↓
【Reviewer 子会话】只读检查刚写的代码 → 返回审查意见
   ↓
Pi 根据审查意见决定是否需要修改
```

跟 Ch6c 多角色团队的区别：

| 维度 | 本章（Level 1） | Ch6c（Level 3） |
|------|----------------|-----------------|
| 角色数 | 1（reviewer） | 3（pm + coder + reviewer） |
| 编排方式 | Leader 直接调，简单 | Leader 按 prompt 自主编排循环 |
| 结构化结论 | 无（纯文字返回） | 有（submit_review 工具） |
| 熔断 | 无 | 有（MAX_CODER_DELEGATIONS） |
| 代码行数 | ~60 | ~230 |

### 6a.2 核心概念：什么是子 Agent 会话

回顾第 1 章：Agent Loop = "模型决定 → 工具执行 → 结果喂回 → 再决定"的循环。一段对话 + 一组工具 + 一个系统提示词 = 一个 Agent。

Pi 的 SDK 提供 `createAgentSession()`，可以在 Extension 内部**创建另一个独立的 Agent 会话**：

```
主会话（Leader）
  ├── 用户对话
  └── 调用 delegate_to_reviewer 工具
        └── 子会话（Reviewer）← 独立的对话历史、独立的工具集、独立的系统提示词
              └── 完成后返回一段文字给主会话
```

子会话的生命周期：创建 → `prompt()` 发送任务 → `subscribe()` 收集输出 → `dispose()` 清理。对主会话来说，`delegate_to_reviewer` 跟调用 `read`、`bash` 没有任何区别——都是"调一个工具，拿一段文字结果"。

### 6a.3 代码

创建 `.pi/extensions/single-reviewer/index.ts`：

```typescript
// 单角色 Subagent：代码审查员
//
// 给 Pi 加一个 delegate_to_reviewer 工具：主 Agent 可以把代码改动
// 交给一个只读的 Reviewer 子会话审查，Reviewer 返回审查意见。
//
// 这是 Ch6c 多角色团队的简化版——只一个角色，不做编排循环，
// 先把 createAgentSession 的核心 API 跑通。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Reviewer 的系统提示词——它的"人设"
const REVIEWER_PROMPT = [
  "你是代码审查员。",
  "你会收到一段代码改动描述和相关信息。",
  "只读代码，不要修改任何文件。",
  "检查以下方面：Bug、安全漏洞、错误处理缺失、命名不当。",
  "给出具体到文件名和行号的审查意见。",
  "如果全部通过，明确说'审查通过'。",
].join("\n");

// Reviewer 只给只读工具——物理上不可能改代码
const REVIEWER_TOOLS = ["read", "grep", "find", "ls"];

// 缓存 ModelRuntime，避免每次调用都重新初始化模型配置
let sharedRuntime: ReturnType<typeof ModelRuntime.create> | undefined;
function getRuntime() {
  if (!sharedRuntime) sharedRuntime = ModelRuntime.create();
  return sharedRuntime;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("single-reviewer 扩展已加载：delegate_to_reviewer 可用", "info");
  });

  pi.registerTool({
    name: "delegate_to_reviewer",
    label: "Delegate to Reviewer",
    description:
      "把代码改动交给一个只读的代码审查员子 Agent 检查。" +
      "审查员会读取相关代码并返回审查意见。",
    parameters: Type.Object({
      task: Type.String({
        description: "审查任务描述，包含改动的文件路径和改动摘要",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const modelRuntime = await getRuntime();

      // 创建子 Agent 会话——独立的对话历史、独立的工具集
      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        sessionManager: SessionManager.inMemory(), // 不持久化，用完就扔
        modelRuntime,
        tools: REVIEWER_TOOLS,
        systemPromptOverride: () => REVIEWER_PROMPT,
        appendSystemPromptOverride: () => [], // 不让 APPEND_SYSTEM.md 污染角色人设
      });

      // 把取消信号接到子 session 上：
      // 用户/上层一旦中止，正在跑的 Reviewer 也要立刻停下
      const onAbort = () => void session.abort();
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // 收集子 Agent 的文字输出
      let output = "";
      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
      });

      try {
        await session.prompt(params.task);
      } finally {
        unsubscribe?.();
        signal.removeEventListener("abort", onAbort);
        session.dispose(); // 清理子会话资源
      }

      return {
        content: [{ type: "text", text: output || "(审查员没有返回内容)" }],
        details: { reviewer: true, task: params.task },
      };
    },
  });
}
```

### 6a.4 代码逐段解释

**先认清新出场的三个核心对象**——这段代码第一次把 SDK 的几个关键对象摆到一起，后面 6c/6d 还会反复用它们：

- **`ModelRuntime`** — "模型连接配置"对象。它封装了"用哪个模型、用什么认证"这套东西——`ModelRuntime.create()` 会去读 `~/.pi/agent/` 下你在 CLI 里 `/login` 存的配置。创建子会话时必须传一个 `modelRuntime`，子会话才知道用哪个模型去想问题。它初始化有成本，所以代码里用 `getRuntime()` 缓存了一份复用，而不是每次 delegate 都新建。

- **`SessionManager`** — "会话存哪"的策略对象。`SessionManager.inMemory()` 表示"这个子会话的历史只存在内存里，跑完就丢，不写文件"。对应地，CLI 里你用的会话是持久化到磁盘的——那用的是另一种 SessionManager。这里要的就是即用即弃的临时会话。

- **`session`（`createAgentSession` 返回的）** — "一个独立 Agent 会话的句柄"。拿到它就等于拥有了一段独立的 Agent Loop：`session.prompt(任务)` 驱动它去想问题、`session.subscribe(回调)` 订阅它吐出的文字和事件、`session.abort()` 打断它、`session.dispose()` 清理资源。这四个方法就是你对一个子会话能做的全部操作。理解了"session = 一段可驱动的独立 Agent Loop"，这章的代码就读懂了一半。

下面按代码顺序逐段看。

**① 系统提示词（REVIEWER_PROMPT）**

```typescript
const REVIEWER_PROMPT = "你是代码审查员。只读代码，不要修改任何文件..."
```

这跟你在 AGENTS.md 里写的内容本质一样——一段告诉模型"你是谁、该怎么做事"的文字。区别是这里只给子会话用，主会话看不到。

**② 工具白名单（REVIEWER_TOOLS）**

```typescript
const REVIEWER_TOOLS = ["read", "grep", "find", "ls"];
```

只给只读工具——Reviewer 在物理上拿不到 `write`/`edit`/`bash`，不是靠 prompt 说"别改代码"。这就是第 5d 章 Mini-lab B 讲的"硬约束"思路的体现。

**③ 创建子会话**

```typescript
const { session } = await createAgentSession({
  cwd: ctx.cwd,                    // 共享工作目录
  sessionManager: SessionManager.inMemory(),  // 不持久化
  modelRuntime,                    // 共享模型配置
  tools: REVIEWER_TOOLS,           // 只读工具
  systemPromptOverride: () => REVIEWER_PROMPT,
  appendSystemPromptOverride: () => [],       // 防污染
});
```

每一个选项都值得记住：
- `SessionManager.inMemory()` — 子会话用完即弃，不写文件
- `systemPromptOverride` — 替换默认系统提示词，只给 Reviewer 的人设
- `appendSystemPromptOverride: () => []` — 不让 `APPEND_SYSTEM.md` 的内容追加到 Reviewer 的提示词后面（否则角色人设会被"污染"）

**④ 收集输出**

```typescript
session.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    output += event.assistantMessageEvent.delta;
  }
});
await session.prompt(params.task);
```

`subscribe` 是事件流——子 Agent 每吐一个字（`text_delta`）都会触发。我们把它们拼成一个完整字符串，作为工具结果返回给主会话。

> 这里的 `event` 跟第 5 章事件拦截里的 `event` 是同一类东西——"这次事件发生了什么"。`message_update` 表示"模型输出有更新"，`assistantMessageEvent.type` 进一步说明更新的类型：`text_delta` 就是"多吐了一段文字"。事件类型有很多种，这里只挑我们关心的（文字）来收集。

**④.5 取消信号传播（`signal`）**

代码里在 `subscribe` 之前还有几行容易被略过但很重要的逻辑：

```typescript
const onAbort = () => void session.abort();
if (signal.aborted) {
  onAbort();
} else {
  signal.addEventListener("abort", onAbort, { once: true });
}
```

这里的 **`signal`** 是 `execute` 参数里的第三个参数（第 5 章讲 `execute` 五参数时提过它）——一个 `AbortSignal`，代表"这次工具调用被取消了吗"。一旦上层（用户按了停止、或 Leader 被中止）触发取消，`signal` 就会 abort。这几行做的是：监听 `signal`，一旦它 abort 就立刻调 `session.abort()` 把子会话也打断——否则用户取消了 Leader，Reviewer 还在后台傻跑。第 6c 章会更详细地讲这个模式。

**⑤ 清理**

```typescript
session.dispose();
```

子会话用完必须 `dispose()`，否则会泄漏资源（事件监听器、可能的缓存等）。

### 6a.5 试跑

```bash
cd 你的项目目录
pi
/trust
/reload
```

然后让 Pi 写一段代码：

```
帮我写一个 src/utils.ts 文件，里面实现一个 debounce 函数
```

Pi 写完后，再让它审查：

```
帮我审查一下刚才写的 debounce 函数
```

你会看到 Pi 调用 `delegate_to_reviewer` 工具，然后一个 Reviewer 子会话被启动——它会 `read` 刚才写的文件，检查代码，返回审查意见。Pi 根据审查意见向你汇报。

### 6a.6 排错提示

- **工具不出现**：确认 `/trust` 和 `/reload`，扩展只在信任后加载
- **Reviewer 什么都不返回**：检查 `params.task` 里有没有给足够上下文（比如文件路径），Reviewer 不知道该读什么文件
- **Reviewer 修改了文件**：不可能——`REVIEWER_TOOLS` 里没有 `write`/`edit`。如果发生了说明你的工具白名单没生效，检查 `tools` 选项是否传对了
- **子会话很慢**：`getRuntime()` 做了缓存，第一次调用初始化模型配置会慢，后续会快

### 6a.7 从这里到 Ch6c

这 60 行代码已经包含了 Ch6c 多角色团队的 **80% 核心 API**：

| 本章已覆盖 | Ch6c 在此基础上加什么 |
|-----------|---------------------|
| `createAgentSession` 创建子会话 | 创建 3 个不同角色的子会话 |
| `tools` 工具白名单 | 每个角色不同的白名单 |
| `systemPromptOverride` 角色人设 | 3 套不同的 system prompt |
| `subscribe` + `prompt` 收集输出 | 同 |
| `signal` + `abort` 取消传播 | 同 |
| `dispose` 清理 | 同 |
| — | `submit_review` 结构化结论 |
| — | `MAX_CODER_DELEGATIONS` 熔断 |
| — | `/team` 命令和 Leader 编排 prompt |

如果你读懂了这 60 行，Ch6c 的 230 行只是在"更多角色"和"更安全"两个方向上展开——没有新的核心 API。

---

← [上一章：第 5d 章 动手——你的第一个 Extension](05d-动手第一个Extension.md) ｜ [下一章：第 6b 章 实战 Level-2：安全编码守卫扩展](06b-实战安全编码守卫.md) →
