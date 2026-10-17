import { qwenJson, type QwenContent } from "./qwen";

export type VehicleVision = { vehicle_model: string | null; license_plate: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; provider: "GLM" | "QWEN" | "NONE"; note: string };

const prompt = "识别图片中明确可见的车辆具体车型和车牌。仅当铭牌、文字或清晰外观足以支持时填写车型；不能只填 Van、SUV 等大类。无法确认填 null。只输出 JSON：{\"vehicle_model\":string|null,\"license_plate\":string|null,\"confidence\":\"HIGH\"|\"MEDIUM\"|\"LOW\"|\"UNKNOWN\"}";

function parsed(value: unknown, provider: VehicleVision["provider"], note: string): VehicleVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim().slice(0, 160) : null;
  const confidence = raw.confidence === "HIGH" || raw.confidence === "MEDIUM" || raw.confidence === "LOW" ? raw.confidence : "UNKNOWN";
  return { vehicle_model: text("vehicle_model"), license_plate: text("license_plate"), confidence, provider, note };
}

async function glm(imageUrl: string): Promise<VehicleVision> {
  if (process.env.AI_VISION_REAL_CALLS_ENABLED !== "true") throw new Error("REAL_CALLS_DISABLED");
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  if (!key) throw new Error("GLM_NOT_CONFIGURED");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GLM_${response.status}`);
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
  return parsed(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 识别建议，需人工核对。");
}

export async function recognizeVehicleImage(imageUrl: string): Promise<VehicleVision> {
  try { return await glm(imageUrl); }
  catch (reason) {
    if (process.env.AI_VISION_REAL_CALLS_ENABLED !== "true") return { vehicle_model: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: "AI 实际调用尚未启用；请人工填写。" };
    try {
      const content: QwenContent = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return parsed(await qwenJson<Record<string, unknown>>([{ role: "user", content }], "qwen3-vl-plus", { timeoutMs: 30_000 }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch { return { vehicle_model: null, license_plate: null, confidence: "UNKNOWN", provider: "NONE", note: "车辆识别暂不可用；请人工填写。" }; }
  }
}
