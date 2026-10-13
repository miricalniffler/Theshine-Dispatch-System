import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const runtime = "nodejs";

type Provider = "qwen" | "deepseek" | "glm";
const maxImageBytes = 3 * 1024 * 1024;
const maxRequestBytes = 4_300_000;
const providers: Record<Provider, { model: string; endpoint: string; key: string | undefined }> = {
  qwen: { model: "qwen3-vl-flash", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", key: process.env.DASHSCOPE_API_KEY },
  deepseek: { model: "deepseek-flash", endpoint: "https://api.deepseek.com/chat/completions", key: process.env.DEEPSEEK_API_KEY },
  glm: { model: "glm-4.6v-flash", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", key: process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY },
};
const vehiclePrompt = `请独立分析这张车辆照片，严格基于可见证据回答。输出中文，明确区分：1. 品牌；2. 最可能的具体车型/车系；3. 可见的判断依据（前脸、车灯、车标、车身轮廓等）；4. 可能混淆的车型；5. 车辆类别（Sedan/SUV/Minivan/Van）；6. 对车型判断的信心（高/中/低）和不确定原因。不确定时必须明确说明，禁止猜测年份、准确座位数、行李容量或车辆许可。请用简洁文本回答。`;
const orderPrompt = `请严格逐字识别这张接送机订单截图中的信息，并按以下字段分行输出：订单号、乘客姓名、电话、航班、接送时间（保留原时区）、上车地址、下车地址、车型、成人、儿童、行李、其他备注。所有字段只能基于图片可见内容，不得凭空补全或翻译专名；无法辨识的写“无法确认”。保留原始拼写、号码和时间。`;
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  if (!process.env.TEAM_ACCESS_TOKEN || request.cookies.get("iway-team-access")?.value !== process.env.TEAM_ACCESS_TOKEN) {
    return reply({ error: "请先登录工作台。" }, 401);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return reply({ error: "图片不可超过 3 MB，请压缩后重试。" }, 413);
  }
  const body = await request.json().catch(() => ({}));
  const image = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  const imageMatch = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  if (!imageMatch || imageMatch[1].length % 4 !== 0) return reply({ error: "请上传 JPG、PNG 或 WebP 图片。" }, 422);
  const bytes = Math.floor(imageMatch[1].length * 3 / 4) - (imageMatch[1].endsWith("==") ? 2 : imageMatch[1].endsWith("=") ? 1 : 0);
  if (bytes > maxImageBytes) return reply({ error: "图片不可超过 3 MB，请压缩后重试。" }, 413);
  const mode = body.mode === "order" ? "order" : body.mode === "vehicle" ? "vehicle" : null;
  if (!mode) return reply({ error: "无效测试类型。" }, 422);
  const prompt = mode === "vehicle" ? vehiclePrompt : orderPrompt;
  const entries = (["qwen", "deepseek", "glm"] as const);
  const results = await Promise.all(entries.map(async provider => {
    const { model, endpoint, key } = providers[provider];
    if (!key) return { provider, model, status: "unconfigured", error: "未配置 API Key", elapsedMs: 0 };
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ] }],
          max_tokens: 1400,
          ...(provider === "glm" ? { thinking: { type: "disabled" } } : {}),
        }),
        signal: AbortSignal.timeout(48_000),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.error?.message === "string" ? data.error.message : `HTTP ${response.status}`;
        throw new Error(message.slice(0, 250));
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("模型未返回文字。");
      return {
        provider, model, status: "ok", text: content.trim(), elapsedMs: Date.now() - started,
        usage: {
          inputTokens: typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null,
          outputTokens: typeof data?.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      return { provider, model, status: "error", error: /timeout|abort/i.test(message) ? "模型响应超时" : message, elapsedMs: Date.now() - started };
    }
  }));
  return reply({ mode, results });
}
