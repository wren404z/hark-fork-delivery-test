import { callTool, listTools } from "./client.js";

export const name = "hark-subagent";
export const inject = ["tools"];

const DEFAULT_ENDPOINT = "http://127.0.0.1:8920";

/** 统一的输出渲染: MCP content 文本 + 结构化内容, */
function output() {
  return {
    schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        structured: { type: "object", additionalProperties: true },
      },
      additionalProperties: true,
    },
    render(_args, value) {
      const out = [{ type: "text", text: String(value?.text ?? "") }];
      return out;
    },
  };
}

/** 调一次 MCP 工具, 返回 { text, structured },错误也走结构化返回, 不抛, */
async function invoke(ctx, toolName, args, exec) {
  const { endpoint } = ctx.__cfg;
  // hark_wait 的 timeout_s 最长 600s, HTTP 超时必须跟着放大, 否则会被误报成"网关超时".
  const waitMs = toolName === "hark_wait" ? (Number(args && args.timeout_s) || 120) * 1000 + 30000 : 0;
  const timeoutMs = waitMs || ctx.__cfg.timeoutMs;
  try {
    const r = await callTool(endpoint, toolName, args, {
      timeoutMs,
      signal: exec?.signal,
    });
    if (r.isError) {
      return {
        text: `hark 工具 ${toolName} 报错: ${r.text || "(无原因)"}`,
        structured: { ok: false, error: r.text || "unknown", reachable: true, ...(r.structured || {}) },
      };
    }
    return { text: r.text || "(空)", structured: { ok: true, reachable: true, ...(r.structured || {}) } };
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    const notReady = err?.notReady === true;
    const msg = String(err?.message ?? err);
    // 三态: timedOut (任务仍在跑) / notReady (子模块未上线) / unreachable (连不上),
    const text = timedOut
      ? `hark 网关调用超时 (${timeoutMs}ms),**这不是任务失败** -- 任务仍在网关侧运行; ` +
        "用 hark_status 查当前状态, 或用 hark_wait 继续等,绝不要因为超时重投或取消,"
      : notReady
        ? `hark 子 agent 服务尚未就绪: ${msg}`
        : `hark 网关不可达或返回异常: ${msg}`;
    return {
      text,
      structured: { ok: false, reachable: !notReady, notReady, timedOut, error: msg },
    };
  }
}

/** 8 个工具的声明,name/description 与网关 §3 契约逐字对应, */
const TOOLS = [
  {
    name: "hark_submit",
    description: [
      "把一个编码任务投递给 hark 云端 agent (当子 agent 用),",
      "它不在本机执行, 也不能建仓库 (hark 无建仓权限),",
      "**repo = 交付目标** (你名下的仓, 最终在那里开 PR), 不是存储仓,",
      "存储: 绑定的 gh-pool 号自己的**私有仓** <gh_user>/hark-store 的 hark/<job_id> 分支, 由系统自动建/复用,",
      "投递前会: 挑一个有额度的 hark 号 -> 校验绑定 (Hark 侧 id 一致 + PAT 可租) -> 新建 hark 项目,",
      "返回 job_id 后立刻用 hark_wait 观察; **不要**假设投递即完成,",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task", "repo"],
      properties: {
        task: { type: "string", description: "自然语言任务描述 (越具体越好, 会被写进 hark 的项目提示词)" },
        repo: {
          type: "string",
          description:
            "**交付目标仓库** full name (HengXin666 名下的仓, PR 开在这里)," +
            "不是存储仓 -- 存储由系统按绑定的 gh-pool 号自动推导为 <gh_user>/hark-store",
        },
        mode: { type: "string", enum: ["auto", "manual"], description: "auto=自动挑号/自动绑定; manual=用 hark_account/gh_user 指定的号" },
        hark_account: { type: "string", description: "指定 hark 账号邮箱 (manual 模式)" },
        gh_user: { type: "string", description: "指定 GitHub 用户名 (manual 模式; 必须已绑到该 hark 号)" },
        workspace: { type: "string", description: "本机工作区绝对路径 (可选, 仅用于给 hark 描述项目背景)" },
        base_branch: { type: "string", description: "基线分支, 默认 main" },
        instructions: { type: "string", description: "额外协作约定 (会追加进提示词)" },
      },
    },
  },
  {
    name: "hark_status",
    description: "查 hark 作业状态,不传 job_id 时返回全部作业 + 账号容量,",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { job_id: { type: "string", description: "作业 id; 缺省=列表" } },
    },
  },
  {
    name: "hark_wait",
    description: [
      "等待作业推进, 最多 timeout_s 秒,",
      "★ 超时**不是失败**: 返回 RUNNING/STALE + resume 摘要, 任务仍在跑,",
      "看到 STALE 说明心跳过期 (网关重启/上游慢), 继续等或 hark_followup 接续, 不要重投也不要 cancel,",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: {
        job_id: { type: "string" },
        timeout_s: { type: "number", description: "最多等多少秒, 默认 120, 上限 600" },
      },
    },
  },
  {
    name: "hark_followup",
    description: "给同一个作业再发一轮 (上下文在 hark 项目里延续),用于补充要求或让它继续未完成的部分,",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "message"],
      properties: {
        job_id: { type: "string" },
        message: { type: "string", description: "追加指令" },
      },
    },
  },
  {
    name: "hark_cancel",
    description: "显式取消作业,**只有人明确要求时才用** -- 超时/心跳过期都不是取消的理由,",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: {
        job_id: { type: "string" },
        reason: { type: "string", description: "取消原因 (会记进作业历史)" },
      },
    },
  },
  {
    name: "hark_accounts",
    description:
      "hark 账号池现状: 存活 / 剩余额度 / 绑定的 GitHub 号," +
      "用于回答用哪个号, 还剩多少额度",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "hark_bind",
    description: [
      "给一个 hark 号绑定 GitHub 账号并做**真值校验** (防假绑定):",
      "① hark 侧 connected 且 accountId 与 GitHub 数字 id 一致 ② 该 GitHub 号 PAT 的 /user 回同一 id ③ 该号 PAT 当下租得到,",
      "不传 gh_user 时自动挑一个空闲号 (一个 GitHub 号只能绑一个 hark 号),",
      "注意: 不再要求 LoLiOA 成员身份 -- 存储走绑定号自己的私有仓, 与组织无关,",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["hark_account"],
      properties: {
        hark_account: { type: "string", description: "hark 账号邮箱" },
        gh_user: { type: "string", description: "GitHub 用户名; 缺省=自动挑" },
      },
    },
  },
  {
    name: "hark_publish",
    description: [
      "把作业产物以**本机 gh 账号 (HengXin666)** 的身份合并到目标仓库并开 PR,",
      "hark 侧只是存储介质; 真正的交付必须走这一步 (主 agent 有 admin 权限, hark 没有),",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: {
        job_id: { type: "string" },
        target_repo: { type: "string", description: "交付目标仓库 full name, 缺省=作业提交时给的 repo" },
        branch: { type: "string", description: "目标分支名, 缺省 hark/<job_id>" },
        title: { type: "string", description: "PR 标题" },
      },
    },
  },
];

// Agent Note: .agents/notes/implemented/feature/2026-10-19-hark-subagent-plugin.md
export function apply(ctx, config = {}) {
  const endpoint = (config.endpoint || process.env.HARK_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const timeoutMs = Number(config.timeoutMs) || 120000;
  ctx.__cfg = { endpoint, timeoutMs };

  // ---- 工具面 ----
  const tools = ctx.tools;
  if (!tools) return;
  for (const t of TOOLS) {
    const definition = {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      output: output(),
      execute: (args, exec) => invoke(ctx, t.name, args, exec),
    };
    ctx.effect(() => tools.register(definition), `hark-subagent.${t.name}`);
  }

  // 启动自检: 网关 tools/list 与本插件是否对得上,
  listTools(endpoint, { timeoutMs: 8000 })
    .then((list) => {
      const remote = new Set((list || []).map((x) => x.name));
      const missing = TOOLS.map((t) => t.name).filter((n) => !remote.has(n));
      if (missing.length) {
        // 不抛: 真实错误由工具调用时带回,
        console.warn(`[hark-subagent] 网关缺少工具: ${missing.join(", ")}`);
      }
    })
    .catch(() => { /* 网关没起也不阻塞宿主 */ });
}
