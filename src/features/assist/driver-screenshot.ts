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
  /** Thai spelling visible in the source, retained for the vehicle/driver audit trail. */
  rawThaiDriverName: string | null;
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
  driverName: null, rawThaiDriverName: null, driverNameSource: "NOT_FOUND", driverPhone: null, licensePlate: null, vehicleBrand: null, vehicleModel: null, vehicleClass: null, confidence: "UNKNOWN", evidence: [],
  provider, model, fallbackReason, note: "未从截图中确认到司机资料；请人工填写，不会写入订单。",
});

function safeString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null; }
function confidence(value: unknown): DriverScreenshotResult["confidence"] { return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNKNOWN"; }
function evidence(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 240)).slice(0, 5) : []; }

export function normalizeDriverScreenshot(raw: Record<string, unknown>, provider: DriverScreenshotResult["provider"], model: string, fallbackReason: string | null): DriverScreenshotResult {
  const extractedName = safeString(raw.driver_name);
  const rawThaiDriverName = safeString(raw.driver_name_thai);
  // IMAGE_ENGLISH is a model-internal distinction.  The persisted domain
  // already uses IMAGE_TRANSLITERATED for image-derived names, so retain that
  // stable public enum and preserve the Thai original separately.
  const source = (raw.driver_name_source === "IMAGE_TRANSLITERATED" || raw.driver_name_source === "IMAGE_ENGLISH") && extractedName ? "IMAGE_TRANSLITERATED" : "NOT_FOUND";
  const driverName = source === "IMAGE_TRANSLITERATED" ? extractedName : null;
  return {
    orderNumber: safeString(raw.order_number), pickupTime: safeString(raw.pickup_time), route: safeString(raw.route), passengerName: safeString(raw.passenger_name),
    passengerCount: safeString(raw.passenger_count), luggage: safeString(raw.luggage), driverName, rawThaiDriverName: driverName ? rawThaiDriverName : null, driverNameSource: source,
    driverPhone: safeString(raw.driver_phone), licensePlate: safeString(raw.license_plate), vehicleBrand: safeString(raw.vehicle_brand), vehicleModel: safeString(raw.vehicle_model), vehicleClass: safeString(raw.vehicle_class), confidence: confidence(raw.confidence), evidence: evidence(raw.evidence), provider, model, fallbackReason,
    note: source === "NOT_FOUND" ? "未能可靠识别司机姓名，字段保持为空；请人工填写。识别结果只作为待核对建议。" : "结果来自截图识别，只作为待核对建议；保存前请人工确认。",
  };
}

export type VisionRecognitionKind = "DRIVER_SCREENSHOT" | "VEHICLE_IMAGE";

const promptFor = (kind: VisionRecognitionKind) => `从这张${kind === "VEHICLE_IMAGE" ? "车辆照片" : "泰语、英文或混合的车队聊天截图"}提取结构化资料。只能依据画面中明确可见的内容，不得猜测或补全。JSON 字段：order_number,pickup_time,route,passenger_name,passenger_count,luggage,driver_name,driver_name_thai,driver_name_source,driver_phone,license_plate,vehicle_brand,vehicle_model,vehicle_class,confidence,evidence。未见或证据不足的字段填 null；confidence 只可为 HIGH、MEDIUM、LOW、UNKNOWN；evidence 是最多5条简短可见依据。driver_name 为画面中直接可见的英文名，或仅在清晰可见泰文姓名时对该泰文名作英文音译；泰文原名放 driver_name_thai。driver_name_source 只可为 IMAGE_ENGLISH、IMAGE_TRANSLITERATED、NOT_FOUND。只有品牌标识、铭牌或文字足以支持时才填写具体 vehicle_model；只看得出大类时 vehicle_model 必须为 null，vehicle_class 可填写较宽泛的等级。`;

function parseModelJson(content: unknown, provider: "GLM" | "QWEN"): Record<string, unknown> {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new Error(`${provider}_EMPTY_RESPONSE`);
  // Some compatible endpoints still fence JSON despite response_format.
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
    return parsed as Record<string, unknown>;
  } catch { throw new Error(`${provider}_INVALID_JSON`); }
}

async function glmJson(imageUrl: string, kind: VisionRecognitionKind) {
  if (process.env.AI_VISION_REAL_CALLS_ENABLED !== "true") throw new Error("REAL_VISION_CALLS_DISABLED");
  // Some existing deployments use the older GLM_API_KEY name. Reuse it
  // safely instead of requiring a duplicate secret, while preferring the
  // documented ZHIPU_API_KEY name for new configuration.
  const apiKey = isIsolatedPreview ? undefined : process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  if (!apiKey) throw new Error("GLM_NOT_CONFIGURED");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    // Z.ai's OpenAI-compatible chat endpoint accepts a data URI in image_url.
    // The browser cannot select an endpoint or model ID.
    body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: promptFor(kind) }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GLM_${response.status}`);
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  return parseModelJson(content, "GLM");
}

export async function recognizeImage(imageUrl: string, kind: VisionRecognitionKind): Promise<DriverScreenshotResult> {
  if (process.env.AI_VISION_MOCK_MODE === "true") return normalizeDriverScreenshot({ driver_name: null, order_number: null }, "MOCK", "mock", "这是本机模拟结果，未调用真实模型。");
  let glmFailure: string | null = null;
  try { return normalizeDriverScreenshot(await glmJson(imageUrl, kind), "GLM", "glm-5.3-flash", null); }
  catch (error) { glmFailure = error instanceof Error ? error.message : "GLM_FAILED"; }
  if (process.env.AI_VISION_REAL_CALLS_ENABLED === "true" && isQwenConfigured()) {
    try {
      const content: QwenContent = [{ type: "text", text: promptFor(kind) }, { type: "image_url", image_url: { url: imageUrl } }];
      const result = await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3.7-plus", { timeoutMs: 30_000 });
      return normalizeDriverScreenshot(result, "QWEN", "qwen3.7-plus", `GLM 主模型不可用：${glmFailure}`);
    } catch (error) { return { ...empty("QWEN", "qwen3.7-plus", `GLM 不可用：${glmFailure}；Qwen 备用失败：${error instanceof Error ? error.message : "UNKNOWN"}`), note: "模型暂时无法识别截图。图片不会保存到数据库，请人工填写。" }; }
  }
  const disabled = glmFailure === "REAL_VISION_CALLS_DISABLED";
  return { ...empty("NONE", null, `GLM 主模型不可用：${glmFailure}`), note: disabled ? "AI 实际调用尚未被管理员启用；请人工填写。图片不会保存到数据库。" : "未配置可用的备用模型。图片不会保存到数据库，请人工填写。" };
}

export function recognizeDriverScreenshot(imageUrl: string) { return recognizeImage(imageUrl, "DRIVER_SCREENSHOT"); }
export function recognizeVehicleImage(imageUrl: string) { return recognizeImage(imageUrl, "VEHICLE_IMAGE"); }
