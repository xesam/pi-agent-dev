## 第 5d 章：动手——你的第一个 Extension

前面两章你创建了 Prompt Template（零代码）和 Skill（零代码）。现在来写真正的代码——Extension。

Extension 是一个 TypeScript 文件，跑在 Node.js 里，能力最强但也需要最多谨慎。它能做三件事：注册工具、拦截事件、注册命令。这一章用两个 mini-lab 各做一个，让你 20 分钟内亲手体验 Extension 的核心能力。

> **预计时间**：20 分钟。需要 Node.js 环境和已安装的 `pi`。

### 5d.1 Extension 能做什么（快速回顾）

| 能力 | 函数 | 一句话 |
|------|------|--------|
| 注册工具 | `pi.registerTool(...)` | 给模型新增一个可调用的动作 |
| 拦截事件 | `pi.on("tool_call", ...)` | 在工具执行前/后插入检查逻辑 |
| 注册命令 | `pi.registerCommand(...)` | 新增一个 `/命令` |

下面两个 mini-lab 分别做前两个——注册工具和拦截事件。注册命令在 Ch6a 里会有完整示例。

### 5d.2 Mini-lab A：自定义工具 `fetch_url`（约 15 行代码）

**场景**：你想让 Pi 能读取网页内容——默认的 `read` 工具只能读本地文件。

**第 1 步**：创建文件 `.pi/extensions/fetch-url.ts`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description: "获取一个 URL 的网页文本内容。当用户要求查看网页、获取在线文档时使用。",
    parameters: Type.Object({
      url: Type.String({ description: "要获取的 URL 地址" }),
    }),
    async execute(_toolCallId, params) {
      const res = await fetch(params.url);
      const text = await res.text();
      // 截断到 5000 字符，避免把超长网页塞进 context
      return {
        content: [{ type: "text", text: text.slice(0, 5000) }],
        details: { url: params.url, status: res.status },
      };
    },
  });
}
```

**第 2 步**：测试。

```bash
pi
/trust
/reload
```

然后跟 Pi 说：

```
帮我看看 https://example.com 这个网页的内容
```

如果一切正常，你会看到模型调用了 `fetch_url` 工具，拿到了网页内容，然后给你总结。

**第 3 步**：观察 `description` 的作用。

试着把 `description` 改成只有一个字 `"获取网页"`，`/reload` 后再说同样的请求——模型可能就不调这个工具了，因为它"不知道"这个工具该在什么时候用。

再改回来，加上"当用户要求查看网页、获取在线文档时使用"——模型又会自动调用了。

> **关键理解**：`description` 是模型决定"要不要用这个工具"的唯一依据。它不是一个文档注释，而是一个**行为指令**——你要告诉模型**什么时候该用它**。

**核心要点解释**：

- `import type { ExtensionAPI }` — 类型导入，不产生运行时代码
- `Type.Object({ url: Type.String() })` — 用 typebox 定义参数的 JSON Schema，模型就是看这个 schema 知道该传什么参数
- `execute` 返回的 `content` 是工具结果，会作为一条新 message 塞回对话——这就是第 1 章说的"结果喂回 messages"
- `throw` 才算失败，`return` 一个值永远不会被标记为出错——这是 Pi 的设计约定

### 5d.3 Mini-lab B：事件拦截——拦住危险命令（约 8 行代码）

**场景**：你不希望 Pi 执行 `rm -rf` 这类危险命令。不靠在 prompt 里说"别删文件"（软约束），而是用代码物理拦截（硬约束）。

**第 1 步**：创建文件 `.pi/extensions/safety-guard.ts`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm(
        "⚠️ 危险操作",
        `即将执行：${event.input.command}\n确定要继续吗？`,
      );
      if (!ok) return { block: true, reason: "被用户拦截" };
    }
  });
}
```

**就这么几行**——监听 `tool_call` 事件，检查是不是 `bash` 工具、命令里有没有 `rm -rf`，有就弹确认框，用户拒绝就返回 `{ block: true }` 阻止执行。

**第 2 步**：测试。

```bash
pi
/trust
/reload
```

然后跟 Pi 说：

```
帮我删掉 /tmp/test 目录下的所有文件
```

模型可能会决定调用 `bash` 执行 `rm -rf /tmp/test`——这时你的扩展会弹出一个确认框。选择"否"，命令被阻止，模型会收到"被用户拦截"的反馈，然后换一种方式或向你解释。

**第 3 步**：扩展拦截规则。

试着把拦截条件扩展到更多危险命令：

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;

  const cmd = event.input.command as string;
  const dangerous = ["rm -rf", "git push --force", "sudo", "DROP TABLE"];

  if (dangerous.some((d) => cmd.includes(d))) {
    const ok = await ctx.ui.confirm("⚠️ 危险操作", `即将执行：${cmd}\n确定要继续吗？`);
    if (!ok) return { block: true, reason: "被用户拦截" };
  }
});
```

**核心要点解释**：

- `pi.on("tool_call", ...)` — 监听工具调用事件，**在工具真正执行之前**运行
- `return { block: true, reason: "..." }` — 阻止这个工具调用，`reason` 会作为工具结果返回给模型
- `ctx.ui.confirm` — 弹出确认框，返回 `true`/`false`。只在交互模式（TUI）下有效
- 这跟 Mini-lab A 的 `registerTool` 是完全不同的"挂钩点"——一个是**给模型加新能力**，一个是**在已有能力上加检查**

### 5d.4 两个 Mini-lab 的关系

```
Mini-lab A (registerTool)     →  模型多了一个"动作"可以调
Mini-lab B (pi.on tool_call)  →  模型已有的"动作"被加了一道检查

两者可以组合在同一个扩展里：
  注册一个新工具，同时在 tool_call 里拦截它——
  下一章 Ch6a 就会看到这种组合。
```

这正是第 6 章多角色扩展的基础——`delegate` 工具就是用 `registerTool` 注册的，而安全相关的检查（如熔断）就是用代码逻辑在 `execute` 里拦截的。Ch6a 会带你从单角色开始，Ch6c 则把三个角色组合在一起。

### 5d.5 Extension 存放位置

| 位置 | 作用域 | 说明 |
|------|--------|------|
| `~/.pi/agent/extensions/*.ts` | 全局 | 所有项目都加载 |
| `~/.pi/agent/extensions/*/index.ts` | 全局（目录形式） | 多文件扩展用 |
| `.pi/extensions/*.ts` | 项目级（需 `/trust`） | 跟项目绑定 |
| `.pi/extensions/*/index.ts` | 项目级（目录形式） | 多文件扩展用 |

> **安全提醒**：Extension 以你的完整系统权限运行——它能做的事情跟你自己敲命令一样多。只安装你信任的扩展。项目级扩展在 `/trust` 之前不会加载，这是一道安全边界。

### 5d.6 可选练习

**练习 1**：给 `fetch_url` 工具加上超时处理和错误处理：

```typescript
async execute(_toolCallId, params) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(params.url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { content: [{ type: "text", text: `HTTP ${res.status}` }], details: {} };
    }
    const text = await res.text();
    return { content: [{ type: "text", text: text.slice(0, 5000) }], details: { url: params.url, status: res.status } };
  } catch (e) {
    return { content: [{ type: "text", text: `请求失败：${e}` }], details: {} };
  }
}
```

**练习 2**：把 Mini-lab B 改成"只拦截但不弹框"——直接 block 所有 `rm -rf`，不给确认机会：

```typescript
if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
  return { block: true, reason: "rm -rf 被禁止执行" };
}
```

这就是"硬约束"的极致形态——模型"想不听话"也做不到。

### 5d.7 本章要点

- Extension = TypeScript 文件，导出一个默认函数，接收 `ExtensionAPI`
- 三件事：`registerTool`（加工具）、`pi.on`（拦事件）、`registerCommand`（加命令）
- `description` 不是文档注释，是告诉模型**什么时候用这个工具**的行为指令
- `tool_call` 事件 + `{ block: true }` 是"硬约束"拦截——比在 prompt 里说"别删文件"可靠
- Extension 以完整系统权限运行，只装你信任的扩展
- **从上往下选扩展方式**：能用模板解决的别用 Skill，能用 Skill 解决的别写 Extension

---

← [上一章：第 5c 章 动手——你的第一个 Skill](05c-动手第一个Skill.md) ｜ [下一章：第 6a 章 实战 Level-1：单角色 Subagent](06a-实战单角色Subagent.md) →
