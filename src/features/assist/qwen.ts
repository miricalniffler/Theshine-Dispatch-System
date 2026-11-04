type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type QwenContent = string | Array<TextPart | ImagePart>;

type QwenMessage = { role: "system" | "user"; content: QwenContent };

const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export function isQwenConfigured() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

export type QwenModel = "qwen-flash" | "qwen3-vl-plus" | "qwen3-vl-flash" | "qwen3.7-plus" | "qwen3.7-flash";

export async function qwenJson<T>(messages: QwenMessage[], model: QwenModel, options: { timeoutMs?: number } = {}): Promise<T> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("QWEN_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, enable_thinking: false, response_format: { type: "json_object" }, temperature: 0.1 }),
      // 车辆拼图、夜间照片的视觉理解会比纯文字慢；路由允许的时间内给它足够余量。
      signal: AbortSignal.timeout(options.timeoutMs ?? 110_000),
    });
  } catch (error) {
    if (error instanceof Error && /timeout|abort/i.test(error.message)) throw new Error("车辆图片识别超时，请重试；原始图片已保留。");
    throw error;
  }
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    // Keep only status and a safe provider code: never expose echoed input or keys.
    const providerCode = (body as { error?: { code?: unknown } }).error?.code;
    const safeCode = typeof providerCode === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(providerCode) ? providerCode : "UNKNOWN";
    throw new Error(`QWEN_${response.status}_${safeCode}`);
  }
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Qwen 未返回可读取的识别结果。");
  try { return JSON.parse(content) as T; }
  catch { throw new Error("Qwen 返回格式无法识别，请重试。"); }
}
