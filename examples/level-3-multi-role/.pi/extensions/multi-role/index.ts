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
