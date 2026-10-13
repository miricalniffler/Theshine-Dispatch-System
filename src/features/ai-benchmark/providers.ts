import { type BenchmarkProvider, type ResolvedSelection } from "@/features/ai-benchmark/catalog";

type Usage = { inputTokens: number | null; outputTokens: number | null };
export type ProviderResult = { provider: BenchmarkProvider; model: string; region?: string; status: "ok" | "error" | "unconfigured"; text?: string; error?: string; errorCode?: string; elapsedMs: number; usage?: Usage };

const endpoints = { qwen: { "cn-beijing": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "ap-southeast-1": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" }, deepseek: "https://api.deepseek.com/chat/completions", glm: "https://open.bigmodel.cn/api/paas/v4/chat/completions" } as const;
function apiKey(provider: BenchmarkProvider) { return provider === "qwen" ? process.env.DASHSCOPE_API_KEY : provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY; }
function endpoint(selection: ResolvedSelection) { return selection.provider === "qwen" ? endpoints.qwen[selection.region as keyof typeof endpoints.qwen] : endpoints[selection.provider]; }
function friendlyHttpError(status: number) {
  if (status === 400 || status === 422) return { code: "PARAMETER_INCOMPATIBLE", message: "调用参数与该模型不兼容。请切换已验证型号或查看供应商文档。" };
  if (status === 401 || status === 403) return { code: "ACCOUNT_OR_PERMISSION", message: "服务商拒绝访问。请由管理员检查 API Key、账户权限或地域授权。" };
  if (status === 404) return { code: "MODEL_OR_REGION_UNAVAILABLE", message: "该模型在当前地域不可用，或服务商已调整模型 ID。" };
  if (status === 429) return { code: "RATE_LIMITED", message: "服务商暂时限流，请稍后再试。" };
  if (status >= 500) return { code: "PROVIDER_UNAVAILABLE", message: "服务商暂时不可用，请稍后重试。" };
  return { code: `HTTP_${status}`, message: `服务商请求失败（HTTP ${status}）。` };
}

export async function runVisionBenchmark(selection: ResolvedSelection, image: string, prompt: string): Promise<ProviderResult> {
  const key = apiKey(selection.provider);
  const base = { provider: selection.provider, model: selection.modelId, ...(selection.region ? { region: selection.region } : {}) };
  if (!key) return { ...base, status: "unconfigured", error: "未配置 API Key", errorCode: "API_KEY_MISSING", elapsedMs: 0 };
  const started = Date.now();
  try {
    const response = await fetch(endpoint(selection), { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: selection.modelId, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }], max_tokens: 1400, ...(selection.provider === "glm" ? { thinking: { type: "disabled" } } : {}) }), signal: AbortSignal.timeout(48_000), cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = friendlyHttpError(response.status); return { ...base, status: "error", error: error.message, errorCode: error.code, elapsedMs: Date.now() - started }; }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { ...base, status: "error", error: "模型未返回可读取的文字结果。", errorCode: "EMPTY_RESPONSE", elapsedMs: Date.now() - started };
    return { ...base, status: "ok", text: content.trim(), elapsedMs: Date.now() - started, usage: { inputTokens: typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null, outputTokens: typeof data?.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null } };
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
    return { ...base, status: "error", error: timedOut ? "模型响应超时。" : "无法连接到服务商。", errorCode: timedOut ? "TIMEOUT" : "NETWORK_ERROR", elapsedMs: Date.now() - started };
  }
}
