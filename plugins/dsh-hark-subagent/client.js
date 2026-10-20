const RPC_PATH = "/mcp";
const DEFAULT_TIMEOUT = 120000;

/** 一次 JSON-RPC 调用,失败抛 Error; 网关未就绪时带 notReady 标记, */
// Agent Note: .agents/notes/implemented/feature/2026-10-19-hark-subagent-plugin.md
export async function rpc(endpoint, method, params, { timeoutMs, signal } = {}) {
  const signals = [AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT)];
  if (signal) signals.push(signal);
  const res = await fetch(endpoint.replace(/\/+$/, "") + RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 1e9, method, params: params || {} }),
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
  });
  const text = await res.text();
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`hark 网关返回非 JSON (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
  if (doc.error) {
    if (typeof doc.error === "string") {
      const err = new Error(`${doc.error}: ${doc.module || "?"} (${doc.reason || "no reason"})`);
      err.code = doc.error;
      err.notReady = doc.error === "subagent_module_not_ready";
      throw err;
    }
    const err = new Error(`MCP ${doc.error.code ?? ""}: ${doc.error.message || "unknown"}`);
    err.code = doc.error.code;
    throw err;
  }
  if (!doc.result) throw new Error("MCP 响应缺少 result");
  return doc.result;
}

/** tools/call: 返回 { text, structured, isError }, */
export async function callTool(endpoint, name, args, opts = {}) {
  const result = await rpc(endpoint, "tools/call", { name, arguments: args || {} }, opts);
  const text = (result.content || [])
    .filter((c) => c && c.type === "text")
    .map((c) => c.text || "")
    .join("\n");
  return { text, structured: result.structuredContent, isError: !!result.isError };
}

/** tools/list, */
export async function listTools(endpoint, opts = {}) {
  const result = await rpc(endpoint, "tools/list", {}, opts);
  return result.tools || [];
}
