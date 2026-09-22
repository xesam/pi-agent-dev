// 数据分析与报表生成扩展（Level 2.5）
//
// 场景：读取 data/sales.csv（月度销售流水），按用户的自然语言要求
// 生成一张「汇总表 + 关键洞察」的 Markdown 数据报表。
//
// 流水线（collect → filter → aggregate → narrate → render）：
//
//   你（用户）："按地区汇总销售额，只看华东和华南，给出增长最快的产品线"
//      ↓ analyze_sales 工具
//   【收集】   代码 parseCsv()                —— 读文件不需要智能
//   【筛选】   Analyst（LLM 子 Agent）把自然语言要求翻译成
//              submit_filter 的结构化条件     —— 哪些行进报表是判断
//   【计算】   代码 aggregateBy()/growthOf()  —— 求和、分组、增长率不交给模型
//   【洞察】   Analyst 阅读（代码算好的）聚合结果，
//              用 submit_insights 交付结论    —— 写什么洞察是判断
//   【渲染】   代码 renderReport()            —— 表格排版、竖线转义是计算
//
// 本章的核心模式一句话：**确定性工作交给代码，判断性工作交给模型**。
//   - "算术"是可精确验证的产物 → 代码算，数字永远可复现
//   - "理解自然语言要求、决定写什么结论" → 模型判断
//
// 交接物全部是结构化 JSON（submit_filter / submit_insights），
// 这是第 6d 章 submit_review（结构化 verdict）的直系前身。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. 确定性部分：解析 CSV + 聚合计算 + 渲染 Markdown（纯代码，无 LLM）
// ---------------------------------------------------------------------------

interface SalesRow {
  month: string;
  region: string;
  product: string;
  revenue: number;
  units: number;
}

type Dimension = "region" | "product" | "month";
const DIMENSIONS = ["region", "product", "month"] as const;

/** 结构化筛选条件：模型把自然语言要求翻译成这三个字段 + 要出表的维度。 */
interface FilterSpec {
  regions?: string[];
  products?: string[];
  months?: string[];
  groupBy: Dimension[];
}

interface Insight {
  finding: string;
  evidence: string;
}

/** 解析 data/sales.csv。失败抛错，由工具层接住转成友好提示。 */
function parseCsv(cwd: string): SalesRow[] {
  const raw = readFileSync(join(cwd, "data", "sales.csv"), "utf8").trim();
  const [header, ...lines] = raw.split("\n");
  if (header !== "month,region,product,revenue,units") {
    throw new Error(`CSV 表头不符合预期：${header}`);
  }
  return lines.map((line) => {
    const [month, region, product, revenue, units] = line.split(",");
    return { month, region, product, revenue: Number(revenue), units: Number(units) };
  });
}

/** 按结构化条件过滤行（字段缺省 = 不过滤该维度）。 */
function filterRows(rows: SalesRow[], filter: FilterSpec): SalesRow[] {
  const inSet = (v: string, set?: string[]) => !set || set.includes(v);
  return rows.filter(
    (r) => inSet(r.region, filter.regions) && inSet(r.product, filter.products) && inSet(r.month, filter.months)
  );
}

/** 按维度分组求和：营收、销量、环比增长率（首月 → 末月）。 */
function aggregateBy(rows: SalesRow[], dim: Dimension) {
  const groups = new Map<string, SalesRow[]>();
  for (const r of rows) {
    const key = r[dim];
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const revenue = rs.reduce((s, r) => s + r.revenue, 0);
      const units = rs.reduce((s, r) => s + r.units, 0);
      // 增长率是典型的"必须交给代码"的计算：按月排好后取首末两月
      const byMonth = new Map<string, number>();
      for (const r of rs) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.revenue);
      const monthsSorted = [...byMonth.keys()].sort();
      let growth: number | null = null;
      if (monthsSorted.length >= 2) {
        const first = byMonth.get(monthsSorted[0])!;
        const last = byMonth.get(monthsSorted[monthsSorted.length - 1])!;
        if (first > 0) growth = (last - first) / first;
      }
      return { key, revenue, units, growth };
    })
    .sort((a, b) => b.revenue - a.revenue); // 表格按营收降序，排版规则也是确定性的
}

/** 确定性渲染：竖线转义 + 数字格式化由代码保证，模型不参与格式。 */
const fmt = (n: number) => n.toLocaleString();

function formatMarkdownTable(headers: string[], body: string[][]): string {
  const escape = (s: string) => String(s).replace(/\|/g, "\\|");
  const lines = [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map((cells) => `| ${cells.map(escape).join(" | ")} |`),
  ];
  return lines.join("\n");
}

const DIM_LABEL: Record<Dimension, string> = { region: "地区", product: "产品", month: "月份" };

/** 渲染最终报表：每维度一张汇总表 + 洞察列表。 */
function renderReport(aggregates: { dim: Dimension; rows: ReturnType<typeof aggregateBy> }[], insights: Insight[]): string {
  const parts: string[] = [];
  for (const { dim, rows } of aggregates) {
    parts.push(`### 按${DIM_LABEL[dim]}汇总\n`);
    parts.push(
      formatMarkdownTable(
        [DIM_LABEL[dim], "营收（元）", "销量（件）", "增长率"],
        rows.map((r) => [
          r.key,
          fmt(r.revenue),
          fmt(r.units),
          r.growth === null ? "—" : `${(r.growth * 100).toFixed(1)}%`,
        ])
      )
    );
    parts.push("");
  }
  if (insights.length > 0) {
    parts.push("### 关键洞察\n");
    for (const ins of insights) parts.push(`- **${ins.finding}**（${ins.evidence}）`);
    parts.push("");
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 2. 扩展入口：/sales 命令 + analyze_sales 工具
// ---------------------------------------------------------------------------

let sharedModelRuntimePromise: ReturnType<typeof ModelRuntime.create> | undefined;
function getSharedModelRuntime() {
  if (!sharedModelRuntimePromise) {
    sharedModelRuntimePromise = ModelRuntime.create();
  }
  return sharedModelRuntimePromise;
}

// 角色提示词的覆盖点在 ResourceLoader 上（新版 API）。
// 注意：自带的 loader 不会被 createAgentSession 自动 reload，必须手动调一次。
async function roleLoader(cwd: string, prompt: string) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    systemPromptOverride: () => prompt, // 替换基础系统提示词为角色人设
    appendSystemPromptOverride: () => [], // 不让 APPEND_SYSTEM.md 污染角色人设
  });
  await loader.reload();
  return loader;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("data-collector 扩展已加载：输入 /sales 生成销售数据报表", "info");
  });

  pi.registerCommand("sales", {
    description: "读取 data/sales.csv，按自然语言要求生成数据报表",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "请在对话中描述分析要求（如“只看华东和华南，按产品汇总，指出增长最快的产品线”），模型会调用 analyze_sales 生成报表",
        "info"
      );
    },
  });

  // ---- 核心工具：analyze_sales ----
  // Leader 调用它 → 内部创建 Analyst 子 Agent → Analyst 先后用 submit_filter /
  // submit_insights 交付结构化结果 → 本工具用纯代码渲染报表 → 返回给 Leader。
  pi.registerTool({
    name: "analyze_sales",
    label: "Analyze sales data into a report",
    description:
      "读取项目的 data/sales.csv（月度销售流水），按 requirement 生成「汇总表 + 关键洞察」Markdown 报表。" +
      "requirement 里写清筛选范围和关注的维度，例如“只看华东和华南，按产品汇总，指出增长最快的产品线”。",
    parameters: Type.Object({
      requirement: Type.String({ description: "分析要求：筛选范围、要汇总的维度、想看什么结论" }),
    }),
    promptSnippet: "analyze_sales - 读取销售流水，按要求筛选、汇总并生成数据报表",
    promptGuidelines: [
      "analyze_sales 工具：把用户的分析要求原样写进 requirement，不要自己先筛一遍。",
      "analyze_sales 工具：返回的已经是渲染好的 Markdown 报表，直接展示给用户即可，不要再重新排版或复述数字。",
    ],
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // 1.【收集】读文件失败不抛给用户，转成友好提示（详见 6c.5 常见坑）
      let allRows: SalesRow[];
      try {
        allRows = parseCsv(ctx.cwd);
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `读取 data/sales.csv 失败：${e instanceof Error ? e.message : String(e)}。请确认示例数据文件存在。`,
            },
          ],
          details: {},
        };
      }
      onUpdate?.({ content: [{ type: "text", text: `[analyst] 共 ${allRows.length} 行流水，开始分析...` }], details: {} });

      const validRegions = [...new Set(allRows.map((r) => r.region))];
      const validProducts = [...new Set(allRows.map((r) => r.product))];
      const validMonths = [...new Set(allRows.map((r) => r.month))].sort();

      // 两次结构化交接，都用闭包变量捕获：
      //   submit_filter  → 模型判断：哪些行进报表、按什么维度出表
      //   submit_insights → 模型判断：哪些结论值得写（evidence 必须引用代码算出的数字）
      let capturedFilter: FilterSpec | null = null;
      let capturedInsights: Insight[] | null = null;

      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        sessionManager: SessionManager.inMemory(),
        modelRuntime: await getSharedModelRuntime(),
        tools: ["list_raw_rows", "submit_filter", "submit_insights"], // 白名单必须列出 customTools 的名字；通用工具一个不给
        customTools: [
          {
            name: "list_raw_rows",
            label: "List raw sales rows",
            description: "获取销售流水的全部原始数据（月份/地区/产品/营收/销量）。",
            parameters: Type.Object({}),
            async execute() {
              return { content: [{ type: "text", text: JSON.stringify(allRows) }], details: {} };
            },
          },
          {
            name: "submit_filter",
            label: "Submit structured filter",
            description:
              "提交结构化筛选条件（本任务第一步）。regions/products/months 缺省表示不过滤该维度；" +
              "groupBy 是要出汇总表的维度，至少一个。提交后工具会返回由代码算好的聚合结果。",
            parameters: Type.Object({
              regions: Type.Optional(Type.Array(Type.String())),
              products: Type.Optional(Type.Array(Type.String())),
              months: Type.Optional(Type.Array(Type.String())),
              groupBy: Type.Array(StringEnum(DIMENSIONS)),
            }),
            async execute(_id, p: FilterSpec) {
              // 校验不过就不捕获、返回错误文本，让模型修正后重新提交
              const check = (label: string, given: string[] | undefined, valid: string[]) => {
                const bad = (given ?? []).filter((v) => !valid.includes(v));
                return bad.length > 0 ? `${label} 中存在未知值：${bad.join("、")}（有效值：${valid.join("、")}）` : null;
              };
              const err =
                check("regions", p.regions, validRegions) ??
                check("products", p.products, validProducts) ??
                check("months", p.months, validMonths);
              if (err) return { content: [{ type: "text", text: `筛选条件有误：${err}` }], details: {} };
              if (p.groupBy.length === 0)
                return { content: [{ type: "text", text: "groupBy 不能为空，请至少选择一个汇总维度。" }], details: {} };
              const filtered = filterRows(allRows, p);
              if (filtered.length === 0)
                return { content: [{ type: "text", text: "筛选结果为空，请放宽条件后重新提交。" }], details: {} };
              capturedFilter = p;
              // 【计算】聚合交给代码：模型拿到的每个数字都是算好的
              const aggregates = p.groupBy.map((dim) => ({ dim, rows: aggregateBy(filtered, dim) }));
              return {
                content: [
                  {
                    type: "text",
                    text:
                      `筛选后剩 ${filtered.length} 行。以下是代码计算出的聚合结果（营收单位：元；` +
                      `growth 为首月到末月的增长率），请基于这些数字提出洞察：\n` +
                      JSON.stringify(aggregates),
                  },
                ],
                details: { rows: filtered.length },
              };
            },
          },
          {
            name: "submit_insights",
            label: "Submit key insights",
            description: "提交 1-3 条关键洞察（本任务第二步，也是最终交付）。evidence 必须引用聚合结果里的具体数字。",
            parameters: Type.Object({
              insights: Type.Array(
                Type.Object({
                  finding: Type.String({ description: "一句话结论" }),
                  evidence: Type.String({ description: "支撑该结论的具体数字，来自 submit_filter 返回的聚合结果" }),
                })
              ),
            }),
            async execute(_id, p: { insights: Insight[] }) {
              capturedInsights = p.insights;
              return { content: [{ type: "text", text: `已记录 ${p.insights.length} 条洞察。` }], details: {} };
            },
          },
        ],
        // 新版 API：角色提示词通过 resourceLoader 注入（见上方 roleLoader helper）
        resourceLoader: await roleLoader(ctx.cwd, [
          "你是数据分析员（Analyst）。",
          `用户要求：${params.requirement}`,
          "工作流程（两步，缺一不可）：",
          "1. 先调用 list_raw_rows 查看全部原始流水；",
          "2. 把用户要求翻译成结构化条件，调用 submit_filter 提交（regions/products/months/groupBy）；",
          "   工具会返回由代码算好的聚合结果。",
          "3. 阅读聚合结果，调用 submit_insights 提交 1-3 条关键洞察，",
          "   evidence 必须引用聚合结果中的具体数字——不要自己心算，算术一律以工具返回为准。",
          "不要输出表格——渲染由外部代码完成，你只负责筛选条件和洞察。",
        ].join("\n")),
      });

      // 取消传播：上层中止时子 Agent 立刻停（第 6a 章学的模式）
      const onAbort = () => void session.abort();
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });

      try {
        await session.prompt(`分析销售数据并提交：${params.requirement}`);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        session.dispose();
      }

      if (!capturedFilter) {
        return {
          content: [{ type: "text", text: "ANALYST_DID_NOT_SUBMIT: Analyst 未调用 submit_filter，请重试。" }],
          details: { submitted: false },
        };
      }

      // 【渲染】确定性渲染：格式与数字都不经过模型
      // （capturedFilter 在闭包里赋值，类型系统看不见，需显式断言一次）
      const filter = capturedFilter as FilterSpec;
      const selectedRows = filterRows(allRows, filter);
      const aggregates = filter.groupBy.map((dim: Dimension) => ({
        dim,
        rows: aggregateBy(selectedRows, dim),
      }));
      const insights = capturedInsights ?? [];
      const report =
        renderReport(aggregates, insights) +
        (capturedInsights ? "" : "\n（Analyst 未提交洞察，以上仅有汇总表。）");
      return {
        content: [{ type: "text", text: report }],
        details: { rows: selectedRows.length, insights: insights.length },
      };
    },
  });
}
