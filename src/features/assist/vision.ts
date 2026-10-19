import { qwenJson, type QwenContent } from "./qwen";
import { AI_MODELS } from "./model-config";

export type VehicleVision = { vehicle_brand: string | null; vehicle_model: string | null; vehicle_category: string | null; license_plate: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; provider: "GLM" | "QWEN" | "NONE"; note: string };
export type ScreenshotVision = { order_number: string | null; driver_name: string | null; driver_phone: string | null; license_plate: string | null; vehicle_model: string | null; confidence: VehicleVision["confidence"]; provider: VehicleVision["provider"]; note: string };

/** A separate, deliberately opt-in switch for paid image and OCR requests. */
export function isAiVisionRealCallsEnabled() { return process.env.AI_VISION_REAL_CALLS_ENABLED === "true"; }

const prompt = "识别图片中明确可见的车辆品牌、具体车型、适用车辆等级和车牌。仅当铭牌、文字或清晰外观足以支持时填写品牌或车型；不能猜测。vehicle_category 可填 Sedan、SUV、Van、Minibus 等大类，但无法确认则填 null。只输出 JSON：{\"vehicle_brand\":string|null,\"vehicle_model\":string|null,\"vehicle_category\":string|null,\"license_plate\":string|null,\"confidence\":\"HIGH\"|\"MEDIUM\"|\"LOW\"|\"UNKNOWN\"}";

function parsed(value: unknown, provider: VehicleVision["provider"], note: string): VehicleVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim().slice(0, 160) : null;
  const confidence = raw.confidence === "HIGH" || raw.confidence === "MEDIUM" || raw.confidence === "LOW" ? raw.confidence : "UNKNOWN";
  return { vehicle_brand: text("vehicle_brand"), vehicle_model: text("vehicle_model"), vehicle_category: text("vehicle_category"), license_plate: text("license_plate"), confidence, provider, note };
}

function failureReason(error: unknown, provider: "GLM" | "QWEN") {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (/REAL_CALLS_DISABLED/.test(code)) return "实际调用未开启";
  if (/_NOT_CONFIGURED/.test(code)) return `${provider} 服务未配置`;
  if (/(?:_401|_403)/.test(code)) return `${provider} 账户或权限不可用`;
  if (/_404/.test(code)) return `${provider} 模型不可用或不支持当前参数`;
  if (/_429/.test(code)) return `${provider} 请求过于频繁，请稍后重试`;
  if (/(?:timeout|abort|_408)/i.test(code)) return `${provider} 在 30 秒内未完成`;
  if (/EMPTY_RESPONSE/.test(code)) return `${provider} 未返回可读取结果`;
  if (/JSON|格式/.test(code)) return `${provider} 返回格式无法识别`;
  return `${provider} 调用失败`;
}

function unavailableVehicleNote(glmError: unknown, qwenError: unknown) {
  return `车辆识别未完成：${failureReason(glmError, "GLM")}；${failureReason(qwenError, "QWEN")}。请人工填写，原始图片未被自动写入订单。`;
}

function unavailableScreenshotNote(glmError: unknown, qwenError: unknown) {
  return `截图识别未完成：${failureReason(glmError, "GLM")}；${failureReason(qwenError, "QWEN")}。请人工核对截图内容。`;
}

async function glm(imageUrl: string): Promise<VehicleVision> {
  if (!isAiVisionRealCallsEnabled()) throw new Error("REAL_CALLS_DISABLED");
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  if (!key) throw new Error("GLM_NOT_CONFIGURED");
  const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
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
    const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content: [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GLM_${response.status}`);
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
    return screenshot(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 截图识别建议，需人工核对。");
  } catch (reason) {
    try {
      const content: QwenContent = [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return screenshot(await qwenJson<Record<string, unknown>>([{ role: "user", content }], AI_MODELS.vehicleVision.fallback.model, { timeoutMs: AI_MODELS.vehicleVision.fallback.timeoutMs }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch (fallbackError) { return { order_number: null, driver_name: null, driver_phone: null, license_plate: null, vehicle_model: null, confidence: "UNKNOWN", provider: "NONE", note: unavailableScreenshotNote(reason, fallbackError) }; }
  }
}

export async function recognizeVehicleImage(imageUrl: string): Promise<VehicleVision> {
  try { return await glm(imageUrl); }
  catch (reason) {
    if (!isAiVisionRealCallsEnabled()) return { vehicle_brand: null, vehicle_model: null, vehicle_category: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: "AI 实际调用尚未启用；请人工填写。" };
    try {
      const content: QwenContent = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return parsed(await qwenJson<Record<string, unknown>>([{ role: "user", content }], AI_MODELS.vehicleVision.fallback.model, { timeoutMs: AI_MODELS.vehicleVision.fallback.timeoutMs }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch (fallbackError) { return { vehicle_brand: null, vehicle_model: null, vehicle_category: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: unavailableVehicleNote(reason, fallbackError) }; }
  }
}
