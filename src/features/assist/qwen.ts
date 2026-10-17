import { isIsolatedPreview } from "@/lib/isolated-preview";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type QwenContent = string | Array<TextPart | ImagePart>;

type QwenMessage = { role: "system" | "user"; content: QwenContent };

const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export function isQwenConfigured() {
  return !isIsolatedPreview && Boolean(process.env.DASHSCOPE_API_KEY);
}

export async function qwenJson<T>(
  messages: QwenMessage[],
  model: "qwen-flash" | "qwen3-vl-plus" | "qwen3-vl-flash" | "qwen3.7-plus" | "qwen3.7-flash",
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const apiKey = isIsolatedPreview ? undefined : process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("QWEN_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, temperature: 0.1 }),
      // Existing callers keep their generous budget; the GLM fallback gives
      // Qwen an explicit 30-second budget.
      signal: AbortSignal.timeout(options.timeoutMs ?? 110_000),
    });
  } catch (error) {
    if (error instanceof Error && /timeout|abort/i.test(error.message)) throw new Error("车辆图片识别超时，请重试；原始图片已保留。");
    throw error;
  }
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body && typeof (body as { error?: { message?: unknown } }).error?.message === "string"
      ? (body as { error: { message: string } }).error.message : `Qwen 服务返回 ${response.status}`;
    throw new Error(message);
  }
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Qwen 未返回可读取的识别结果。");
  try { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as T; }
  catch { throw new Error("Qwen 返回格式无法识别，请重试。"); }
}
