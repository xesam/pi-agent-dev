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
