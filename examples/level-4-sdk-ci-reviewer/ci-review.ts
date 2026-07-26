/**
 * CI 代码审查脚本
 *
 * 用法：node --experimental-strip-types ci-review.ts "$(git diff --cached)"
 * 效果：读取 git diff，让只读 Agent 审查，输出报告到 stdout
 *
 * 需要：设置 ANTHROPIC_API_KEY 环境变量（或其他已配置的模型）
 *
 * 对应教程章节：第 6d 章 实战 Level-4：用 SDK 嵌入 Pi
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
