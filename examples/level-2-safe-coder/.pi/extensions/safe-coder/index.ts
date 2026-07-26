// 安全编码守卫扩展
//
// 功能：
// 1. 拦截对保护路径的 write/edit（.env、.git/、node_modules/）
// 2. 拦截危险 bash 命令（rm -rf、git push --force、sudo），弹确认
// 3. /safe 命令切换安全模式开关
// 4. 用 pi.appendEntry 持久化开关状态，支持会话分支
//
// 设计要点：
// - 保护路径和危险命令是硬约束（代码层 block），不靠 prompt
// - 安全模式开关本身也持久化到会话——fork 后状态正确

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── 安全策略配置 ──────────────────────────────────────────

const PROTECTED_PATHS = [".env", ".git/", "node_modules/"];

const DANGEROUS_COMMANDS = ["rm -rf", "git push --force", "git push -f", "sudo", "DROP TABLE"];

// ── 扩展入口 ──────────────────────────────────────────────

interface SafeState {
  enabled: boolean;
}

export default function (pi: ExtensionAPI) {
  let safeMode = true; // 默认开启

  // ── 4. 状态持久化：从会话历史重建开关状态 ──
  const reconstructState = (ctx: ExtensionContext) => {
    safeMode = true; // 默认值
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "safe-coder-state") {
        const data = entry.data as SafeState | undefined;
        if (data) safeMode = data.enabled;
      }
    }
    updateStatus(ctx);
  };

  const updateStatus = (ctx: ExtensionContext) => {
    if (safeMode) {
      ctx.ui.setStatus("safe-coder", ctx.ui.theme.fg("warning", "🛡 safe"));
    } else {
      ctx.ui.setStatus("safe-coder", undefined);
    }
  };

  const persistState = (ctx: ExtensionContext) => {
    pi.appendEntry("safe-coder-state", { enabled: safeMode } as SafeState);
    updateStatus(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    reconstructState(ctx);
    ctx.ui.notify(`safe-coder 已加载：安全模式 ${safeMode ? "开启" : "关闭"}`, "info");
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructState(ctx);
  });

  // ── 3. /safe 命令：切换开关 ──
  pi.registerCommand("safe", {
    description: "切换安全模式（拦截危险操作）",
    handler: async (_args, ctx) => {
      safeMode = !safeMode;
      ctx.ui.notify(`安全模式已${safeMode ? "开启 🛡" : "关闭 ⚠️"}`, safeMode ? "info" : "warning");
      persistState(ctx);
    },
  });

  // ── 1. 拦截 write/edit：检查保护路径 ──
  pi.on("tool_call", async (event, ctx) => {
    if (!safeMode) return;

    // 拦截对保护路径的写入
    if (event.toolName === "write" || event.toolName === "edit") {
      const filePath = (event.input as { path?: string }).path ?? "";
      const isProtected = PROTECTED_PATHS.some((p) => filePath.includes(p));
      if (isProtected) {
        if (ctx.hasUI) {
          ctx.ui.notify(`🛡 已拦截对保护路径的写入：${filePath}`, "warning");
        }
        return { block: true, reason: `路径 "${filePath}" 受保护，写入被阻止` };
      }
    }

    // 拦截危险 bash 命令
    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command ?? "";
      const isDangerous = DANGEROUS_COMMANDS.some((d) => command.includes(d));
      if (isDangerous && ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "🛡 危险操作确认",
          `即将执行：${command}\n\n确定要继续吗？`,
        );
        if (!ok) {
          return { block: true, reason: "被用户拦截" };
        }
      }
    }
  });
}
