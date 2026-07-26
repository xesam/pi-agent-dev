## 第 6c 章：实战 Level-3：多角色 Agent 团队

理论讲完了，现在动手做一个真正"多角色协作"的 Agent 产品。

> **前置阅读**：本章假设你已经读了 [第 6a 章（单角色 Subagent）](06a-实战单角色Subagent.md)和[第 6b 章（安全编码守卫）](06b-实战安全编码守卫.md)，理解了 `createAgentSession`、工具白名单、事件拦截和状态持久化。本章把这三者组合成完整的多角色系统。

### 6.1 需求与设计

我们要做的是一个迷你"软件团队"：

```
用户提一个需求
   ↓
【PM 角色】把需求拆成任务列表 + 验收标准（只读工具，不许改代码）
   ↓
【Coder 角色】照着任务列表去实现（读写工具 + bash）
   ↓
【Reviewer 角色】照着验收标准审查 Coder 的结果（只读工具，不许改代码）
   ↓
   通过？ → 结束，汇报用户
   不通过？ → 把审查意见打回给 Coder，回到"实现"那一步
```

**核心设计问题**：Pi 官方没有内置"多 Agent"或"sub-agent"这个概念（前面第 2.2 节提过），那我们怎么实现"角色"？

先别急着看答案，跟着推导一遍。我们要的"角色"需要具备三样东西：

1. **独立的人设**——PM、Coder、Reviewer 各有一套自己的"该怎么做事"的指令，互不干扰。
2. **独立的工具集**——PM 和 Reviewer 不能改代码，Coder 才能写文件、跑命令。
3. **独立的对话**——Coder 在干活时它自己跟模型的来回，不应该污染 Leader 的对话历史。

而第 1 章讲的 Agent Loop，本质就是"一段对话 + 一组工具 + 一个系统提示词"在循环。Pi 的 SDK 提供的 `createAgentSession()` 恰好能一次给齐这三样：它的 `systemPromptOverride` 给独立人设，`tools` 给独立工具白名单，每次调用都是一个全新的 in-memory 会话、独立的对话历史。三样对三样，拼上就是——

> **一个"角色" = 一个用特定 system prompt + 特定工具集创建出来的独立 AgentSession。**

而"团队协作"的编排逻辑，我们不用自己写状态机——直接让**主 Agent 本身充当 Leader**，给它一个 `delegate(role, task)` 工具，它自己就会按 system prompt 里教它的流程，反复调用 `delegate` 在三个角色之间转发任务，直到 Reviewer 提交的结构化结论里 `verdict` 是 `approved`。

这是一个很典型的思路："复杂的编排逻辑，不一定要用代码写死，可以写成给模型看的说明书，让模型自己去编排。" 当然如果你想要更强的确定性（比如严格要求"最多重试 3 次"），也完全可以把循环逻辑用普通 TypeScript 代码写出来——本章末尾会提到这个扩展方向。

在进入代码之前，先用一个**软约束失效**的小场景把这条原则讲透——它贯穿整个 6.3 节：

> 你给 Coder 的 prompt 里郑重写了一句"不要删除任何文件"。但 Coder 手上有 `bash` 工具。模型某次跑命令时顺手带了个 `rm`，文件没了——它没"听话"，可它在物理上完全做得到。这句 prompt 是**软约束**：它只是一句请求，模型可以选择遵守也可以不遵守，工具的能力没被限制。

同样这件事，**硬约束**的做法是：干脆不给 Coder 那个能 `rm` 的工具，或者把 `bash` 换成一层自己做路径校验的包装工具、越界命令直接拒绝。模型"想不听话"也做不到——能力被物理裁掉了。代码比 prompt 可靠，就是因为代码不会"选择忽略"。

记住这个对比。下面 6.3 节里会看到三处一模一样的套路：

> 1. PM/Reviewer 被限制成只读工具集——不是靠 prompt 说"别改代码"，而是物理上拿不到 `write`/`edit`。
> 2. Reviewer 的审查结论用一个专属工具 `submit_review` 结构化提交（`verdict: "approved"|"rejected"`），而不是靠"回复必须以 APPROVED 开头"这种字符串前缀去猜。
> 3. Coder 的返工次数在代码里设了硬上限（`MAX_CODER_DELEGATIONS`），超限后 `delegate` 直接拒绝执行，而不是只在 prompt 里写"最多重试几次"指望模型自觉遵守。

### 6.2 项目结构

```
my-team-project/
├── .pi/
│   └── extensions/
│       └── multi-role/
│           └── index.ts     ← 核心扩展代码
└── AGENTS.md                 ← 项目说明（可选）
```

### 6.3 编写扩展代码

新建 `.pi/extensions/multi-role/index.ts`：

**先别急着读 230 行代码。** 花半分钟看这张地图——代码按注释分成了几块，知道每块干什么，再往下读会轻松很多：

| 区块 | 代码里的注释标记 | 干什么 |
|---|---|---|
| ① 定义角色 | `// 1. 定义角色` | 一个 `ROLES` map：每个角色 = 一段 system prompt + 一组工具白名单 |
| ② 共享模型运行时 | `// 子 Agent 复用同一个 ModelRuntime` | 缓存模型配置，避免每次 delegate 都重新初始化 |
| ③ 重试熔断常量 | `// 1b. 重试熔断` | `MAX_CODER_DELEGATIONS=4` 加一个计数器，coder 超限就拒绝执行 |
| ④ 扩展入口 | `// 2. 扩展入口` | `export default` 那个函数，注册了下面两样东西 |
| ⑤ `delegate` 工具 | `// ---- 核心工具：delegate ----` | 本扩展的核心。Leader 调它派活给角色，内部创建子会话、跑完、返回结果 |
| ⑥ `/team` 命令 | `// ---- 便捷命令：/team ...` | 用户入口，发一段编排指令给 Leader，触发整个流程 |

其中 ⑤ `delegate` 工具内部又分几步，读的时候可以盯着这条主线：**熔断检查 → 创建子会话 → 接 abort 信号 → 收集输出 → reviewer 特殊处理 → 返回结果**。后面"关键点解释"会逐条对应到这条主线。

```typescript
// 多角色 Agent 团队扩展
//
// 这个扩展给 Pi 加了一个 `delegate` 工具：主 Agent（团队 Leader）可以调用它，
// 把子任务派给某个"角色"（PM / Coder / Reviewer），每个角色是一个独立的、
// 拥有专属 system prompt 与工具集的子 Agent Session。
//
// 配合 `/team` 命令，用户只需要描述一个需求，主 Agent 就会扮演 Leader，
// 反复调用 delegate 在三个角色之间传递任务，直到 Reviewer 通过为止。
//
// v2 修订（评审后落实）：
//   1. Reviewer 不再靠"回复必须以 APPROVED/REJECTED 开头"这种字符串前缀软约束，
//      而是给它一个专属工具 submit_review，强制以结构化参数交付审查结论——
//      工具参数是硬约束，模型讲话格式是软约束，前者更可靠。
//   2. 加入代码层的重试熔断：coder 被连续 delegate 的次数超过上限后，
//      delegate 工具会直接拒绝执行并提示 Leader 停止循环、如实汇报，
//      不再完全依赖 prompt 里"最多重试几次"这句话来自我约束。
//   3. 子 Agent 现在会监听工具调用的 abort signal，一旦上层调用被取消，
//      立刻调用子 session.abort()，避免用户取消后 Coder 仍在后台继续跑。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// 1. 定义角色：每个角色 = 一段 system prompt + 一组允许使用的工具
// ---------------------------------------------------------------------------

type RoleName = "pm" | "coder" | "reviewer";

const ROLES: Record<RoleName, { prompt: string; tools: string[] }> = {
  pm: {
    prompt: [
      "你是团队里的产品经理（PM）。",
      "你的职责：把一句模糊的需求拆解成清晰的、可执行的任务列表，",
      "列出验收标准（怎样才算做完/做对）。",
      "你只做拆解和规划，不要自己写代码或修改文件。",
      "只用只读工具去了解现有代码库结构，帮助你写出贴合实际的任务。",
      "回复格式：一段简要说明 + 一份编号任务列表 + 一份验收标准列表。",
    ].join("\n"),
    tools: ["read", "grep", "find", "ls"],
  },
  coder: {
    prompt: [
      "你是团队里的程序员（Coder）。",
      "你会收到 PM 给出的任务列表和验收标准，有时还会收到 Reviewer 的驳回意见。",
      "请直接动手实现：读代码、写代码、跑必要的命令。",
      "实现完成后，用简短的话总结你改了什么、为什么这么改。",
      "不要询问用户确认，你就是被派来干活的执行者，直接做。",
    ].join("\n"),
    tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  },
  reviewer: {
    prompt: [
      "你是团队里的代码审查员（Reviewer）。",
      "你会收到 PM 的验收标准和 Coder 的实现结果。",
      "只读代码，不要修改任何文件。",
      "对照验收标准逐条检查，找出问题（bug、遗漏、风格问题）。",
      "检查完成后，你必须调用 submit_review 工具来提交你的最终结论，",
      "这是唯一有效的交付方式——不要只用文字描述结论而不调用工具。",
      "verdict 填 approved 表示全部通过，填 rejected 表示不通过；",
      "comments 里写清楚具体问题，越具体越好（比如指出文件名和大致位置）。",
    ].join("\n"),
    tools: ["read", "grep", "find", "ls", "submit_review"],
  },
};

// 子 Agent 复用同一个 ModelRuntime，避免每次 delegate 都重新初始化一次模型配置。
let sharedModelRuntimePromise: ReturnType<typeof ModelRuntime.create> | undefined;
function getSharedModelRuntime() {
  if (!sharedModelRuntimePromise) {
    sharedModelRuntimePromise = ModelRuntime.create();
  }
  return sharedModelRuntimePromise;
}

// ---------------------------------------------------------------------------
// 1b. 重试熔断：coder 在一轮 /team 会话里最多被 delegate 这么多次。
//     纯靠 prompt 说"最多重试 N 次"不可靠（模型可能不遵守），
//     这里在代码层强制拦截，超限后 delegate 直接拒绝执行。
// ---------------------------------------------------------------------------

const MAX_CODER_DELEGATIONS = 4; // 首次实现 + 最多 3 次返工
let coderDelegationCount = 0;

// ---------------------------------------------------------------------------
// 2. 扩展入口
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("multi-role 扩展已加载：可用角色 pm / coder / reviewer", "info");
  });

  // ---- 核心工具：delegate ----
  pi.registerTool({
    name: "delegate",
    label: "Delegate to role",
    description:
      "把一个子任务派给团队里的某个角色（pm/coder/reviewer），" +
      "对方会用自己独立的子 Agent 会话完成任务并把结果返回给你。",
    parameters: Type.Object({
      role: StringEnum(["pm", "coder", "reviewer"] as const),
      task: Type.String({
        description: "要交给这个角色的具体任务描述，需要包含足够的上下文",
      }),
    }),
    promptSnippet: "delegate - 把子任务派给 pm/coder/reviewer 角色执行",
    promptGuidelines: [
      "delegate 工具：每次只派给一个角色，等它返回结果后再决定下一步。",
      "delegate 工具：正常流程是 pm 拆任务 -> coder 实现 -> reviewer 审查，" +
        "如果 reviewer 返回的 verdict 是 rejected，把审查意见连同原任务再派给 coder 修复。",
      "delegate 工具：reviewer 的结论是结构化的 verdict 字段（approved/rejected），" +
        "以此判断是否通过，不要凭空猜测或依赖它的自然语言措辞。",
      "delegate 工具：coder 的返工次数有上限，如果工具返回里出现"
        + "'CIRCUIT_BREAKER'，说明已达上限，必须立刻停止循环，如实向用户汇报未解决的问题。",
    ],
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const role = params.role as RoleName;

      // --- 重试熔断：超过上限直接拒绝，不再创建子 Agent ---
      if (role === "coder") {
        coderDelegationCount += 1;
        if (coderDelegationCount > MAX_CODER_DELEGATIONS) {
          return {
            content: [
              {
                type: "text",
                text:
                  `CIRCUIT_BREAKER: coder 已被 delegate ${coderDelegationCount} 次，` +
                  `超过上限 ${MAX_CODER_DELEGATIONS} 次。请立刻停止循环，` +
                  "向用户如实汇报当前未解决的问题，不要再次 delegate 给 coder。",
              },
            ],
            details: { role, circuitBreakerTripped: true },
          };
        }
      }

      const roleConfig = ROLES[role];
      onUpdate?.({ content: [{ type: "text", text: `[${role}] 开始处理...` }] });

      const modelRuntime = await getSharedModelRuntime();

      // reviewer 专属：submit_review 结构化交付工具。
      // 用闭包变量捕获这次调用里 reviewer 提交的结论，而不是去解析自由文本。
      let capturedVerdict: { verdict: "approved" | "rejected"; comments: string } | null = null;
      const customTools =
        role === "reviewer"
          ? [
              {
                name: "submit_review",
                label: "Submit review",
                description: "提交本次代码审查的最终结论，审查流程必须以调用本工具结束。",
                parameters: Type.Object({
                  verdict: StringEnum(["approved", "rejected"] as const),
                  comments: Type.String({
                    description: "审查意见：approved 时简述通过原因，rejected 时给出具体问题列表",
                  }),
                }),
                async execute(_id: string, verdictParams: { verdict: "approved" | "rejected"; comments: string }) {
                  capturedVerdict = verdictParams;
                  return {
                    content: [{ type: "text", text: `已记录审查结论：${verdictParams.verdict}` }],
                    details: {},
                  };
                },
              },
            ]
          : [];

      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        sessionManager: SessionManager.inMemory(),
        modelRuntime,
        tools: roleConfig.tools,
        customTools,
        systemPromptOverride: () => roleConfig.prompt,
        appendSystemPromptOverride: () => [],
      });

      // 把上层工具调用的取消信号接到子 session 上：
      // 用户/上层一旦中止，正在跑的子 Agent（尤其持有 bash/write 的 coder）也要立刻停下。
      const onAbort = () => {
        void session.abort();
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }

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
        session.dispose();
      }

      // reviewer 角色：优先返回结构化结论；如果模型没按要求调用 submit_review
      // （极端情况下发生），退化为把原始文字返回给 Leader，而不是假装有结论。
      if (role === "reviewer") {
        if (capturedVerdict) {
          const verdict: { verdict: "approved" | "rejected"; comments: string } = capturedVerdict;
          return {
            content: [
              {
                type: "text",
                text: `verdict: ${verdict.verdict}\ncomments: ${verdict.comments}`,
              },
            ],
            details: { role, verdict: verdict.verdict, comments: verdict.comments },
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                "REVIEWER_DID_NOT_SUBMIT: reviewer 没有调用 submit_review 就结束了，" +
                "以下是它的原始文字，不能视为可靠结论，请重新 delegate 给 reviewer：\n" +
                (output || "(无输出)"),
            },
          ],
          details: { role, verdictMissing: true },
        };
      }

      return {
        content: [{ type: "text", text: output || "(该角色没有返回任何内容)" }],
        details: { role, task: params.task },
      };
    },
  });

  // ---- 便捷命令：/team <需求描述> ----
  pi.registerCommand("team", {
    description: "启动多角色团队，把 <需求描述> 交给 PM/Coder/Reviewer 协作完成",
    handler: async (args, ctx) => {
      const requirement = args?.trim();
      if (!requirement) {
        ctx.ui.notify("用法：/team 你的需求描述", "warning");
        return;
      }

      // 每次 /team 开启新的一轮协作，重置熔断计数器。
      coderDelegationCount = 0;

      const kickoff = [
        "你现在是团队 Leader，你有一个 `delegate` 工具，可以把任务派给 pm / coder / reviewer 三个角色。",
        "标准流程：",
        "1. 先 delegate 给 pm，让它把需求拆成任务列表和验收标准。",
        "2. 把 pm 的任务列表 delegate 给 coder 去实现。",
        "3. 把 pm 的验收标准 + coder 的实现总结 delegate 给 reviewer 去审查。",
        "4. reviewer 的结果里会带结构化的 verdict 字段：",
        "   - verdict 是 rejected：把 comments 里的意见连同原任务再 delegate 给 coder 修复，回到第 3 步。",
        "   - verdict 是 approved：向用户总结整个过程和最终结果，然后结束。",
        `5. 如果 delegate 的返回内容里出现 CIRCUIT_BREAKER，说明返工次数已达上限（${MAX_CODER_DELEGATIONS} 次），`,
        "   必须立刻停止循环，如实向用户汇报当前还没解决的问题，不要再尝试 delegate 给 coder。",
        "",
        `现在的需求是：${requirement}`,
      ].join("\n");

      pi.sendUserMessage(kickoff);
    },
  });
}
```

**代码里几个关键点解释：**

1. **每个角色的"人设"就是一段 system prompt** —— 跟你在跟同事交代任务时说的话没有本质区别，只是写成了代码常量。这就是"Prompt Engineering"在 Agent 系统里的真实样子。
2. **`tools: roleConfig.tools` 是安全边界** —— PM 和 Reviewer 被限制成只读工具，物理上就不可能手滑改代码，不需要靠"提示词说别改代码"这种软约束。这是本教程反复强调的一个原则：**能用工具白名单做的约束，就不要只靠 prompt 去"求"模型遵守**。
3. **`appendSystemPromptOverride: () => []`** 是一个容易踩的坑——如果不设置，Pi 会自动把 `APPEND_SYSTEM.md` 追加到你精心定制的角色 prompt 后面，导致角色人设被"污染"。
4. **子 Agent 通过 `subscribe` 收集 `text_delta` 拼出完整回复**，再作为 `delegate` 工具的返回值交回给 Leader（主 Agent）。对 Leader 来说，`delegate` 跟调用 `read`、`bash` 没有任何区别——都是"调用一个工具，拿到一段文字结果"，这正是这套设计的优雅之处：**多 Agent 协作，对外表现就是"一个普通工具调用"**。
5. **Reviewer 的结论用 `submit_review` 这个专属工具结构化提交，而不是解析文字前缀**——`delegate` 工具给 `role === "reviewer"` 的子 session 额外注入了一个只有它能用的 `customTools`，模型必须调用 `submit_review({ verdict, comments })` 才能把结论带出来。工具参数是 JSON Schema 校验过的硬数据，比"要求模型的回复必须以 APPROVED 开头"这种字符串前缀可靠得多——万一模型说"基本没问题，APPROVED"，字符串前缀匹配就会失败，但结构化参数不会。如果模型没调用 `submit_review` 就结束了（极端情况），代码会诚实地把这种"结论缺失"标记出来（`REVIEWER_DID_NOT_SUBMIT`），而不是假装解析出了一个结果。
6. **`MAX_CODER_DELEGATIONS` 是代码层的重试熔断**——只在 prompt 里写"最多重试 3 次"是软约束，模型可能不遵守（比如陷入"再试一次"的执念）。这里用一个模块级计数器 `coderDelegationCount`，每次 `delegate` 到 `coder` 就自增，超过上限后 `delegate` 直接返回 `CIRCUIT_BREAKER` 标记而不再创建子 Agent，逼 Leader 停止循环、如实汇报。`/team` 命令在每次启动新一轮协作时会重置这个计数器。
7. **子 Agent 会监听取消信号**——`execute` 的第三个参数 `signal` 是当前这次 `delegate` 工具调用的 `AbortSignal`。代码里给它挂了一个 `abort` 监听器，一旦触发就调用子 `session.abort()`。这样如果用户中途取消了 Leader 的操作（或者 Leader 所在的工具调用被外部终止），正在跑的 Coder 子会话（它持有 `bash`/`write`，如果放任不管可能会继续改文件）也会被一并叫停。注意：Pi 的 `createAgentSession`/`prompt` 本身并不接受一个 `signal` 选项来"传入"取消信号，能拿到的取消信号只在工具的 `execute` 参数里；能中断子 session 的手段是它自带的 `session.abort()` 方法，两者要对应起来用，不要指望把 `signal` 直接塞进 `createAgentSession` 的选项里。

### 6.4 试跑

在项目目录下：

```bash
pi
/trust        # 首次进入需要信任这个项目，才能加载 .pi/extensions
```

信任后重启或 `/reload`，然后：

```
/team 帮我在这个仓库里加一个 add(a, b) 函数并写一个测试
```

你会看到：

1. Leader（主会话）调用 `delegate role=pm ...`
2. 工具返回 PM 拆出的任务列表和验收标准
3. Leader 调用 `delegate role=coder ...`，Coder 子会话真的去 `write`/`edit`/`bash`
4. Leader 调用 `delegate role=reviewer ...` 审查，Reviewer 内部调用 `submit_review` 提交结构化结论
5. 如果返回的 `verdict` 是 `rejected`，Leader 会自动把 `comments` 打回 Coder，重复 3-4；如果连续打回次数超过 `MAX_CODER_DELEGATIONS`，`delegate` 会返回 `CIRCUIT_BREAKER`，Leader 必须停止循环并如实汇报
6. `verdict` 是 `approved` 后，Leader 用自己的话向你总结整个过程

把上面这六步展开成一次真实的调用链（以"被驳回一次、再通过"的典型情况为例），消息是这样在角色间传递的：

```
用户:    /team 帮我加一个 add(a,b) 函数
Leader:  → delegate(role=pm, "拆解这个需求")
PM:       (读代码库) → 返回任务列表 + 验收标准
Leader:  → delegate(role=coder, "按任务列表实现")
Coder:    (write/edit/bash) → 返回实现总结
Leader:  → delegate(role=reviewer, "按验收标准审查")
Reviewer: (读代码) → submit_review(verdict=rejected) → 返回驳回意见
Leader:  → delegate(role=coder, "按驳回意见修复")
Coder:    (edit) → 返回修复总结
Leader:  → delegate(role=reviewer, "重新审查")
Reviewer: → submit_review(verdict=approved)
Leader:  → 向用户总结全过程
```

注意 Leader 自始至终只在做一件事：反复调用 `delegate` 工具。三个子会话彼此看不见对方，它们只把自己当成被派来干一次活的——**"团队协作"完全发生在 Leader 的 Agent Loop 里**，子会话之间没有任何直接通信。这跟第 1 章讲的是同一件事：Agent 就是一段循环，`delegate` 只是循环里一个能"再起一段循环"的工具。

在调用过程中你可以直接看到每次 `delegate` 工具调用的参数（角色+任务）和返回内容，这就是"多角色协作"最直观的调试方式。

也可以单独调试某个角色的 system prompt，不走 Leader：临时改 `promptGuidelines`，或者直接写一个新的 `pi -e` 测试脚本单独 new 一个 `createAgentSession` 试跑该角色的 prompt。

### 6.5 排错提示

- **`/team` 没反应**：先确认项目已被 `/trust`，扩展只在信任后加载；改完代码记得 `/reload`。
- **Reviewer 一直 rejected 但看不出哪里错**：给 `reviewer` 的 prompt 加一句"必须具体到文件名和行号"，逼它给出可执行的意见，而不是空泛评价。
- **Reviewer 完成了检查但 `delegate` 返回 `REVIEWER_DID_NOT_SUBMIT`**：说明模型只用文字描述了结论，没有实际调用 `submit_review` 工具。检查它的 system prompt 是不是把"必须调用 submit_review"这句话写得足够醒目；也可以在 `promptGuidelines` 里再强调一次。
- **一直触发 `CIRCUIT_BREAKER`，但其实任务快改好了**：说明 `MAX_CODER_DELEGATIONS`（默认 4）对这个任务偏小，按需调大；也可以顺便看看是不是 Reviewer 的验收标准定得过于苛刻，导致来回打回。
- **Coder 好心却把不该改的文件也改了**：这属于"该用工具白名单而不是提示词"的经典场景——如果需要限制 Coder 能碰哪些目录，最稳的做法是再包一层自定义工具替代 `bash`/`write`，在 `execute` 里做路径校验并拒绝越界写入，而不是在 prompt 里加"不要动 xxx 目录"。
- **子 Agent 每次都很慢**：注意示例里 `sharedModelRuntimePromise` 做了缓存，避免每次 `delegate` 都重新走一遍模型初始化；如果还是慢，检查是不是每个角色都开了不必要的高 thinking level。

### 6.6 打包成可分享的 Pi Package

把这个扩展变成一个能被别人 `pi install` 的包，只需要在项目根目录加一个 `package.json`：

```json
{
  "name": "pi-multi-role-demo",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "typebox": "*"
  }
}
```

因为扩展放在约定目录 `extensions/`（或本例中项目本身就是 `.pi/extensions/multi-role`），不写 `pi` 字段 Pi 也能按约定目录自动发现。想更明确可以显式加：

```json
"pi": { "extensions": ["./.pi/extensions"] }
```

别人拿到后：`pi install /path/to/pi-multi-role-demo` 或发到 npm/git 后用 `pi install npm:...` / `pi install git:...`。

---

← [上一章：第 6b 章 实战 Level-2：安全编码守卫扩展](06b-实战安全编码守卫.md) ｜ [下一章：第 6d 章 实战 Level-4：用 SDK 嵌入 Pi](06d-实战SDK嵌入Pi.md) →
