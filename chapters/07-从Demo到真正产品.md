← [上一章：第 6e 章 调试与观测](06e-调试与观测.md) ｜ [下一章：第 7b 章 设计模式速查](07b-设计模式速查.md) →

## 第 7 章：从 Demo 到真正的产品——可以往哪些方向扩展

这个三角色 Demo 只是“骨架”，真正做成产品级的东西，可以往这几个方向加。如果不知道先做哪个：**推荐从第 1 项（加角色）和第 6 项（角色做成 Skill）起步**——改动最小、收益最直接；第 2 项（确定性编排）是当你发现 Leader 总是“走错流程”时才需要动用的大改。

1. **更多角色**：加一个 `tester` 角色专门跑测试并把失败日志打回 Coder；加一个 `doc-writer` 角色专门补文档。都是往 `ROLES` 这个 map 里加一条，代价很低。
2. **更强的确定性编排**:本教程的代码已经在 `delegate` 工具层面加了一道硬性熔断(`MAX_CODER_DELEGATIONS`),防止 Reviewer/Coder 无限打回。但"步骤顺序"本身(先 pm、再 coder、再 reviewer)仍然完全交给 Leader 按 prompt 自由决定。如果你不放心这一点,可以把 `/team` 命令的编排逻辑改成用普通 TypeScript 代码写死的状态机(依次调用 `delegate("pm", ...)` → `delegate("coder", ...)` → `delegate("reviewer", ...)`,用 `for` 循环控制重试上限),只把"每一步具体怎么做"留给模型,把"步骤顺序"也收回到代码里。这是"用 Prompt 编排"和"用代码编排"两种风格的权衡:前者灵活、后者更可靠,两者可以按需要混用(正如本教程对"结论交付"和"重试次数"已经做的那样,把最容易出错的两个点用代码兜底,其余仍留给 Leader 自主决策）。

   伪代码示意（把步骤顺序从 prompt 收回到代码）：

   ```typescript
   // /team 的 handler 里，不再发“说明书”给 Leader，而是自己按顺序调 delegate
   const pm = await delegateToRole("pm", requirement);            // 拆任务
   for (let i = 0; i < MAX; i++) {
     const coder = await delegateToRole("coder", pm.tasks + (i ? review.comments : ""));
     const review = await delegateToRole("reviewer", pm.criteria + coder.summary);
     if (review.verdict === "approved") break;                   // 通过就停
   }
   ```

   注意这里的 `delegateToRole` 是你自己包的一层（直接调 `createAgentSession`），不再经过 Leader 的 Agent Loop——步骤顺序变成了硬邦邦的 `for` 循环，但“每一步具体怎么做”仍然留给对应角色的模型。

3. **可视化协作过程**:用 `registerEntryRenderer` + `pi.appendEntry` 把每次 delegate 的角色、任务、结果渲染成一张"任务卡片",而不是纯文字滚动,这样在 TUI 里看多角色协作会清晰很多(参考第 5.3 节 Custom UI 部分文档)。
4. **审计与拦截**：用 `tool_call` 事件拦截 `delegate`，记录每一次角色调用的完整日志到文件，方便复盘"AI 团队"到底做了什么决策——这对于生产环境的可追溯性很重要。
5. **人工介入点**：在 Coder 角色的 `execute` 里，涉及到 `bash` 危险命令时用 `ctx.ui.confirm` 弹出确认（就是第 5.3 节那个 `rm -rf` 拦截的例子），把"全自动"和"人工审批"结合起来。
6. **把角色做成独立 Skill**:如果某个角色需要一套复杂的操作手册(比如 Reviewer 需要遵循公司的编码规范文档),把这部分内容做成一个 Skill 放在 `.pi/skills/`,在角色的 system prompt 里提一句"请先阅读 code-review-standards 这个 Skill",让 Coder/Reviewer 子会话按需去读,而不是把规范全文本硬编码进 system prompt 里撑爆上下文。

   伪代码示意：

   ```typescript
   // reviewer 的 systemPrompt 里加一句
   "审查前先读 code-review-standards 这个 Skill 的 SKILL.md"
   // .pi/skills/code-review-standards/SKILL.md 里放公司的编码规范
   // 子会话启动时只看到 description，觉得相关才去读正文——不撑爆 context
   ```

---

← [上一章：第 6d 章 实战 Level-4：用 SDK 嵌入 Pi](06d-实战SDK嵌入Pi.md) ｜ [下一章：第 7b 章 设计模式速查](07b-设计模式速查.md) →
