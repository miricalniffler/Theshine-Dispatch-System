import { qwenJson, isQwenConfigured, type QwenContent } from "./qwen";
import { isIsolatedPreview } from "@/lib/isolated-preview";

export type ScreenshotNameSource = "IMAGE_TRANSLITERATED" | "SYSTEM_GENERATED" | "NOT_FOUND";
export type DriverScreenshotResult = {
  orderNumber: string | null;
  pickupTime: string | null;
  route: string | null;
  passengerName: string | null;
  passengerCount: string | null;
  luggage: string | null;
  driverName: string | null;
  driverNameSource: ScreenshotNameSource;
  driverPhone: string | null;
  licensePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleClass: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  evidence: string[];
  provider: "GLM" | "QWEN" | "MOCK" | "NONE";
  model: string | null;
  fallbackReason: string | null;
  note: string;
};

const empty = (provider: DriverScreenshotResult["provider"], model: string | null, fallbackReason: string | null): DriverScreenshotResult => ({
  orderNumber: null, pickupTime: null, route: null, passengerName: null, passengerCount: null, luggage: null,
  driverName: null, driverNameSource: "NOT_FOUND", driverPhone: null, licensePlate: null, vehicleBrand: null, vehicleModel: null, vehicleClass: null, confidence: "UNKNOWN", evidence: [],
  provider, model, fallbackReason, note: "未从截图中确认到司机资料；请人工填写，不会写入订单。",
});

function safeString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null; }
function confidence(value: unknown): DriverScreenshotResult["confidence"] { return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNKNOWN"; }
function evidence(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 240)).slice(0, 5) : []; }

export function normalizeDriverScreenshot(raw: Record<string, unknown>, provider: DriverScreenshotResult["provider"], model: string, fallbackReason: string | null): DriverScreenshotResult {
  const extractedName = safeString(raw.driver_name);
  const source = raw.driver_name_source === "IMAGE_TRANSLITERATED" && extractedName ? "IMAGE_TRANSLITERATED" : "NOT_FOUND";
  const driverName = source === "IMAGE_TRANSLITERATED" ? extractedName : null;
  return {
    orderNumber: safeString(raw.order_number), pickupTime: safeString(raw.pickup_time), route: safeString(raw.route), passengerName: safeString(raw.passenger_name),
    passengerCount: safeString(raw.passenger_count), luggage: safeString(raw.luggage), driverName, driverNameSource: source,
    driverPhone: safeString(raw.driver_phone), licensePlate: safeString(raw.license_plate), vehicleBrand: safeString(raw.vehicle_brand), vehicleModel: safeString(raw.vehicle_model), vehicleClass: safeString(raw.vehicle_class), confidence: confidence(raw.confidence), evidence: evidence(raw.evidence), provider, model, fallbackReason,
    note: source === "NOT_FOUND" ? "未能可靠识别司机姓名，字段保持为空；请人工填写。识别结果只作为待核对建议。" : "结果来自截图识别，只作为待核对建议；保存前请人工确认。",
  };
}

const prompt = "从这张泰语、英文或混合的车队截图/车辆照片提取结构化资料。只能依据画面中明确可见的内容，不得猜测或补全。JSON 字段：order_number,pickup_time,route,passenger_name,passenger_count,luggage,driver_name,driver_name_source,driver_phone,license_plate,vehicle_brand,vehicle_model,vehicle_class,confidence,evidence。未见或证据不足的字段填 null；confidence 只可为 HIGH、MEDIUM、LOW、UNKNOWN；evidence 是最多5条简短可见依据。driver_name_source 只有在画面确有泰语司机姓名且能转写时才为 IMAGE_TRANSLITERATED，否则为 NOT_FOUND。";

async function glmJson(imageUrl: string) {
  const apiKey = isIsolatedPreview ? undefined : process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error("GLM_NOT_CONFIGURED");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GLM_${response.status}`);
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
  try { return JSON.parse(content) as Record<string, unknown>; } catch { throw new Error("GLM_INVALID_JSON"); }
}

export async function recognizeDriverScreenshot(imageUrl: string): Promise<DriverScreenshotResult> {
  if (process.env.AI_VISION_MOCK_MODE === "true") return normalizeDriverScreenshot({ driver_name: null, order_number: null }, "MOCK", "mock", "这是本机模拟结果，未调用真实模型。");
  let glmFailure: string | null = null;
  try { return normalizeDriverScreenshot(await glmJson(imageUrl), "GLM", "glm-5.3-flash", null); }
  catch (error) { glmFailure = error instanceof Error ? error.message : "GLM_FAILED"; }
  if (isQwenConfigured()) {
    try {
      const content: QwenContent = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return normalizeDriverScreenshot(await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3.7-plus"), "QWEN", "qwen3.7-plus", `GLM 主模型不可用：${glmFailure}`);
    } catch (error) { return { ...empty("QWEN", "qwen3.7-plus", `GLM 不可用：${glmFailure}；Qwen 备用失败：${error instanceof Error ? error.message : "UNKNOWN"}`), note: "模型暂时无法识别截图。图片不会保存到数据库，请人工填写。" }; }
  }
  return { ...empty("NONE", null, `GLM 主模型不可用：${glmFailure}`), note: "未配置可用的备用模型。图片不会保存到数据库，请人工填写。" };
}
