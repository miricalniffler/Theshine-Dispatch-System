import { qwenJson, type QwenContent } from "./qwen";

export type VehicleVision = { vehicle_model: string | null; license_plate: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; provider: "GLM" | "QWEN" | "NONE"; note: string };
export type ScreenshotVision = { order_number: string | null; driver_name: string | null; driver_phone: string | null; license_plate: string | null; vehicle_model: string | null; confidence: VehicleVision["confidence"]; provider: VehicleVision["provider"]; note: string };

/** A separate, deliberately opt-in switch for paid image and OCR requests. */
export function isAiVisionRealCallsEnabled() { return process.env.AI_VISION_REAL_CALLS_ENABLED === "true"; }

const prompt = "识别图片中明确可见的车辆具体车型和车牌。仅当铭牌、文字或清晰外观足以支持时填写车型；不能只填 Van、SUV 等大类。无法确认填 null。只输出 JSON：{\"vehicle_model\":string|null,\"license_plate\":string|null,\"confidence\":\"HIGH\"|\"MEDIUM\"|\"LOW\"|\"UNKNOWN\"}";

function parsed(value: unknown, provider: VehicleVision["provider"], note: string): VehicleVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim().slice(0, 160) : null;
  const confidence = raw.confidence === "HIGH" || raw.confidence === "MEDIUM" || raw.confidence === "LOW" ? raw.confidence : "UNKNOWN";
  return { vehicle_model: text("vehicle_model"), license_plate: text("license_plate"), confidence, provider, note };
}

async function glm(imageUrl: string): Promise<VehicleVision> {
  if (!isAiVisionRealCallsEnabled()) throw new Error("REAL_CALLS_DISABLED");
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  if (!key) throw new Error("GLM_NOT_CONFIGURED");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GLM_${response.status}`);
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
  return parsed(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 识别建议，需人工核对。");
}

function screenshot(value: unknown, provider: ScreenshotVision["provider"], note: string): ScreenshotVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim().slice(0, 160) : null;
  const confidence = raw.confidence === "HIGH" || raw.confidence === "MEDIUM" || raw.confidence === "LOW" ? raw.confidence : "UNKNOWN";
  return { order_number: text("order_number"), driver_name: text("driver_name"), driver_phone: text("driver_phone"), license_plate: text("license_plate"), vehicle_model: text("vehicle_model"), confidence, provider, note };
}

const screenshotPrompt = "读取泰国车队聊天截图中明确可见的订单号、司机姓名、电话、车牌和具体车型。支持泰文、英文、数字混合。无法确定的字段必须为 null，不能猜测。driver_name 保留截图原文（泰文不要自行翻译）。只输出 JSON：{\"order_number\":string|null,\"driver_name\":string|null,\"driver_phone\":string|null,\"license_plate\":string|null,\"vehicle_model\":string|null,\"confidence\":\"HIGH\"|\"MEDIUM\"|\"LOW\"|\"UNKNOWN\"}";

export async function recognizeFleetScreenshot(imageUrl: string): Promise<ScreenshotVision> {
  if (!isAiVisionRealCallsEnabled()) return { order_number: null, driver_name: null, driver_phone: null, license_plate: null, vehicle_model: null, confidence: "UNKNOWN", provider: "NONE", note: "AI 实际调用尚未启用；请人工录入。" };
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  try {
    if (!key) throw new Error("GLM_NOT_CONFIGURED");
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GLM_${response.status}`);
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
    return screenshot(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 截图识别建议，需人工核对。");
  } catch (reason) {
    try {
      const content: QwenContent = [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return screenshot(await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3.7-plus", { timeoutMs: 30_000 }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch { return { order_number: null, driver_name: null, driver_phone: null, license_plate: null, vehicle_model: null, confidence: "UNKNOWN", provider: "NONE", note: "截图识别暂不可用；请人工录入。" }; }
  }
}

export async function recognizeVehicleImage(imageUrl: string): Promise<VehicleVision> {
  try { return await glm(imageUrl); }
  catch (reason) {
    if (!isAiVisionRealCallsEnabled()) return { vehicle_model: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: "AI 实际调用尚未启用；请人工填写。" };
    try {
      const content: QwenContent = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return parsed(await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3.7-plus", { timeoutMs: 30_000 }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch { return { vehicle_model: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: "车辆识别暂不可用；请人工填写。" }; }
  }
}
