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
  vehicleModel: string | null;
  provider: "GLM" | "QWEN" | "MOCK" | "NONE";
  model: string | null;
  fallbackReason: string | null;
  note: string;
};

const empty = (provider: DriverScreenshotResult["provider"], model: string | null, fallbackReason: string | null): DriverScreenshotResult => ({
  orderNumber: null, pickupTime: null, route: null, passengerName: null, passengerCount: null, luggage: null,
  driverName: null, driverNameSource: "NOT_FOUND", driverPhone: null, licensePlate: null, vehicleModel: null,
  provider, model, fallbackReason, note: "未从截图中确认到司机资料；请人工填写，不会写入订单。",
});

function safeString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null; }
function generatedName(seed: string) {
  const names = ["Anan", "Chai", "Krit", "Niran", "Somchai", "Thanawat"];
  let hash = 0; for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return names[hash % names.length];
}

function normalize(raw: Record<string, unknown>, provider: DriverScreenshotResult["provider"], model: string, fallbackReason: string | null, seed: string): DriverScreenshotResult {
  const driverName = safeString(raw.driver_name);
  const source = raw.driver_name_source === "IMAGE_TRANSLITERATED" && driverName ? "IMAGE_TRANSLITERATED" : driverName ? "NOT_FOUND" : "SYSTEM_GENERATED";
  return {
    orderNumber: safeString(raw.order_number), pickupTime: safeString(raw.pickup_time), route: safeString(raw.route), passengerName: safeString(raw.passenger_name),
    passengerCount: safeString(raw.passenger_count), luggage: safeString(raw.luggage), driverName: driverName ?? generatedName(seed), driverNameSource: source,
    driverPhone: safeString(raw.driver_phone), licensePlate: safeString(raw.license_plate), vehicleModel: safeString(raw.vehicle_model), provider, model, fallbackReason,
    note: source === "SYSTEM_GENERATED" ? "未识别到司机姓名，已给出仅供界面占位的系统临时英文名；该姓名不能用于 i’way 回传，须人工替换确认。" : "结果来自截图识别，只作为待核对建议；保存前请人工确认。",
  };
}

const prompt = "从这张泰语或中泰混合的接送机订单/车队截图提取结构化资料。只能依据画面，不得猜测。JSON 字段：order_number,pickup_time,route,passenger_name,passenger_count,luggage,driver_name,driver_name_source,driver_phone,license_plate,vehicle_model。未见字段填 null。driver_name_source 仅可为 IMAGE_TRANSLITERATED（画面有泰语司机名且转为英文）或 NOT_FOUND。";

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
  if (process.env.AI_VISION_MOCK_MODE === "true") return normalize({ driver_name: null, order_number: null }, "MOCK", "mock", "这是本机模拟结果，未调用真实模型。", imageUrl);
  let glmFailure: string | null = null;
  try { return normalize(await glmJson(imageUrl), "GLM", "glm-5.3-flash", null, imageUrl); }
  catch (error) { glmFailure = error instanceof Error ? error.message : "GLM_FAILED"; }
  if (isQwenConfigured()) {
    try {
      const content: QwenContent = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return normalize(await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3.7-plus"), "QWEN", "qwen3.7-plus", `GLM 主模型不可用：${glmFailure}`, imageUrl);
    } catch (error) { return { ...empty("QWEN", "qwen3.7-plus", `GLM 不可用：${glmFailure}；Qwen 备用失败：${error instanceof Error ? error.message : "UNKNOWN"}`), note: "模型暂时无法识别截图。图片不会保存到数据库，请人工填写。" }; }
  }
  return { ...empty("NONE", null, `GLM 主模型不可用：${glmFailure}`), note: "未配置可用的备用模型。图片不会保存到数据库，请人工填写。" };
}
