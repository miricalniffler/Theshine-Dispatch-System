import { failure, success } from "@/lib/api-response";
import { isQwenConfigured, qwenJson } from "@/features/assist/qwen";
import { NextRequest } from "next/server";

const maxImageBytes = 7 * 1024 * 1024;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(imageDataUrl)) return failure("INVALID_IMAGE", "请选择或粘贴一张 PNG、JPG 或 WebP 格式的订单截图。", undefined, 422);
  const encoded = imageDataUrl.split(",", 2)[1] || "";
  if (encoded.length * 0.75 > maxImageBytes) return failure("IMAGE_TOO_LARGE", "截图过大，请裁剪到订单内容后重试。", undefined, 422);
  if (!isQwenConfigured()) return failure("QWEN_NOT_CONFIGURED", "订单截图识别尚未配置 AI 服务，请改为粘贴订单文字。", undefined, 503);
  try {
    const result = await qwenJson<{ text?: unknown }>([
      { role: "system", content: "你是订单截图转写助手。只逐字转写截图中可见的订单文本，保留原有英文标签、数字、电话、地址、日期和换行。看不清的内容不要猜，保留为空或用 [看不清] 标记。不要翻译、总结、补全或编造字段。必须只输出 JSON：{\"text\":\"...\"}。" },
      { role: "user", content: [{ type: "text", text: "请转写这张 i’way 或 esforty 订单截图。" }, { type: "image_url", image_url: { url: imageDataUrl } }] },
    ], "qwen3-vl-plus");
    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) throw new Error("AI 未返回可读取的订单文字。");
    return success({ text, message: "截图已转写为订单文字。请核对后继续识别字段。" });
  } catch (error) {
    return failure("IMAGE_RECOGNITION_FAILED", `订单截图识别失败：${error instanceof Error ? error.message : "未知原因"}`, undefined, 502);
  }
}
