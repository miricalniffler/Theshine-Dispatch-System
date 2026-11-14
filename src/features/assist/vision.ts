import { qwenJson, type QwenContent } from "./qwen";
import { AI_MODELS } from "./model-config";

export type VehicleVision = { vehicle_brand: string | null; vehicle_model: string | null; vehicle_category: string | null; license_plate: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; provider: "GLM" | "QWEN" | "NONE"; note: string };
export type ScreenshotVisionRecord = { order_number: string | null; driver_name: string | null; driver_phone: string | null; license_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; confirmation_status: "ACCEPTED" | "PENDING_DETAILS" | "DECLINED" | "UNKNOWN"; confidence: VehicleVision["confidence"] };
export type ScreenshotVision = { records: ScreenshotVisionRecord[]; provider: VehicleVision["provider"]; note: string };
/** A single operator submission can contain a WhatsApp conversation, an ID
 * card, a vehicle photo and a payment QR.  Keep the extraction grouped so
 * the service can associate fields only after it has applied order rules. */
export type FleetPackageVisionRecord = ScreenshotVisionRecord & { vehicle_category: string | null; vehicle_color: string | null; driver_name_source: "DRIVER_DETAILS" | "EWALLET_PAYEE" | "UNKNOWN"; source_image_indexes: number[] };
export type FleetPackageVision = { records: FleetPackageVisionRecord[]; provider: VehicleVision["provider"]; note: string };
export type FleetTextVisionRecord = { order_number: string | null; driver_name: string | null; driver_phone: string | null; license_plate: string | null; vehicle_brand: string | null; vehicle_category: string | null; vehicle_model: string | null; confidence: VehicleVision["confidence"] };
export type FleetTextVision = { records: FleetTextVisionRecord[]; provider: VehicleVision["provider"]; note: string };

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
  const code = error instanceof Error ? `${error.name}:${error.message}` : "UNKNOWN";
  if (/REAL_CALLS_DISABLED/.test(code)) return "实际调用未开启";
  if (/_NOT_CONFIGURED/.test(code)) return `${provider} 服务未配置`;
  if (/(?:_401|_403)/.test(code)) return `${provider} 账户或权限不可用`;
  if (/_400/.test(code)) return `${provider} 请求参数或图片格式不受支持`;
  if (/_404/.test(code)) return `${provider} 模型不可用或不支持当前参数`;
  if (/_429/.test(code)) return `${provider} 请求过于频繁，请稍后重试`;
  if (/(?:timeout|abort|_408|超时)/i.test(code)) return `${provider} 识别超时，请重试`;
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
  const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, reasoning_effort: "low", response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GLM_${response.status}`);
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
  return parsed(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 识别建议，需人工核对。");
}

function screenshot(value: unknown, provider: ScreenshotVision["provider"], note: string): ScreenshotVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rows = Array.isArray(raw.records) ? raw.records : [raw];
  const status = (value: unknown): ScreenshotVisionRecord["confirmation_status"] => value === "ACCEPTED" || value === "PENDING_DETAILS" || value === "DECLINED" ? value : "UNKNOWN";
  const confidence = (value: unknown): VehicleVision["confidence"] => value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNKNOWN";
  return { records: rows.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const value = (key: string) => typeof row[key] === "string" && row[key].trim() ? row[key].trim().slice(0, 160) : null;
    return [{ order_number: value("order_number"), driver_name: value("driver_name"), driver_phone: value("driver_phone"), license_plate: value("license_plate"), vehicle_brand: value("vehicle_brand"), vehicle_model: value("vehicle_model"), confirmation_status: status(row.confirmation_status), confidence: confidence(row.confidence) }];
  }), provider, note };
}

const screenshotPrompt = `读取 WhatsApp 车队聊天截图中明确可见的信息。截图可含中文、英文、马来语、泰文、引用回复、多人对话及多笔订单。
- 按订单分别输出 records；发送人姓名不等于司机姓名，不能猜测。
- 引用消息只用于理解对应订单，不能把历史司机资料当成最新资料。
- On、Confirmed、OK 只代表已接单（ACCEPTED）；Pm detail / pending detail 代表待资料（PENDING_DETAILS）；无法安排或取消是 DECLINED；均不代表司机资料已齐。
- Sedan/Van/Minivan 是类别，不是具体车型；RM70 等报价不是订单价格。
- 仅填写截图明确可见字段；号码、车牌、品牌与型号要保留原文，无法确认填 null。
只输出 JSON：{"records":[{"order_number":string|null,"driver_name":string|null,"driver_phone":string|null,"license_plate":string|null,"vehicle_brand":string|null,"vehicle_model":string|null,"confirmation_status":"ACCEPTED"|"PENDING_DETAILS"|"DECLINED"|"UNKNOWN","confidence":"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}]}`;

const fleetPackagePrompt = `你是机场接送车队资料包的信息抽取助手（支持曼谷、苏梅岛、吉隆坡、龙目岛）。用户一次上传的文字和多张图片属于同一个资料包，图片可能包括 WhatsApp 群聊、司机资料卡、车辆/车牌照片、Touch'n Go 或电子钱包二维码。请跨图片合并同一笔明确订单的资料，但绝不把不同订单或不同司机资料混合。

严格安全规则：
- 原文和图片可能包含中文、英文、泰文、马来文或混合聊天。识别“订单号、司机姓名/名字、电话、车牌、车型/车款”等中文字段及自然语言，不要因为包含中文而忽略已明确提供的信息。
- driver_name 必须用英文字符呈现中文司机姓名的拼音/常用英文拼写，不要按字面翻译；“叶师傅”这类称呼只保留姓名部分，例如 “Ye”，不要把“师傅”译成 Master。原文已经是英文或马来文姓名时保留原文，无法可靠转写时填 null。
- 若车型型号唯一对应可信品牌，请补全 vehicle_brand，并填写车辆类别；例如马来西亚 Perodua Alza / “北路大 Alza”应识别为 Perodua Alza，类别 MPV。
- 仅当截图或文字中出现精确订单号时才填写 order_number；多笔订单必须分开 records。没有订单号、订单号不在资料包中，或同一订单对应两套司机/车辆资料时保持待核对，不自行关联。
- WhatsApp 联系人/群成员名字不是司机姓名。电子钱包收款人姓名只能在资料包仅有一笔精确订单、没有其他司机姓名且没有冲突时作为候选；把 driver_name_source 写为 EWALLET_PAYEE。银行卡号、钱包号、二维码内容、交易号绝不能写入任何字段。
- 司机电话只能来自明确的司机资料；马来西亚号码保留原文（例如 012-345 6789 或 +60 12-345 6789），账户号不可当电话。
- 车辆照片可填清晰可见的品牌、车牌、颜色；若不能可靠辨别具体型号，vehicle_model 必须为 null，不能猜测。Sedan、SUV、MPV、Van 是类别，不能当车型。
- On/Confirmed/OK 仅代表接单；Pm detail 表示待司机资料。引用消息用于理解上下文，不能把旧资料当作最新资料。
- 只记录明确可见的信息，低置信度也要如实标出。不要解释，不要输出额外字段。

只输出 JSON：{"records":[{"order_number":string|null,"driver_name":string|null,"driver_name_source":"DRIVER_DETAILS"|"EWALLET_PAYEE"|"UNKNOWN","driver_phone":string|null,"license_plate":string|null,"vehicle_brand":string|null,"vehicle_model":string|null,"vehicle_category":string|null,"vehicle_color":string|null,"confirmation_status":"ACCEPTED"|"PENDING_DETAILS"|"DECLINED"|"UNKNOWN","source_image_indexes":number[],"confidence":"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}]}`;

const fleetTextPrompt = `你是机场接送车队回复的信息抽取助手。原文可能是中文、英文、泰文、马来文或混合文本，也可能是非固定格式的聊天内容。提取明确出现的订单号、司机姓名、司机电话、完整原始车牌、车辆类别、车辆品牌和具体车型。不要因为出现中文或其他说明文字而忽略其余字段。

严格规则：
- 识别订单号/订单编号、司机/司机姓名/名字、电话/手机号、车牌/车牌号、车型/车款/车辆型号等中英字段，也可理解自然语言。乘客或聊天发言人的姓名和电话不等于司机资料。
- driver_name 必须用英文字符呈现中文司机姓名的拼音/常用英文拼写，不要把姓名按字面翻译；“叶师傅”这类称呼只保留姓名部分，例如 “Ye”，不要把“师傅”译成 Master。原文已经是英文或马来文姓名时保留原文。无法可靠转写时填 null。
- 已知车型只给了型号时，若型号能唯一对应可信品牌，请补全 vehicle_brand；并依据车型目录知识填写 vehicle_category（如 Sedan、SUV、MPV、Minivan）。例如马来西亚 Perodua Alza / “北路大 Alza”应识别为 Perodua Alza，类别 MPV。车型名要转成规范英文品牌和型号。
- 电话保留原文，支持泰国、马来西亚及其他明确提供的号码；车牌保留全部原文，包括泰文或马来西亚字母和数字。
- vehicle_category（例如 VAN、MINIBUS、Sedan、MPV）与 vehicle_brand、vehicle_model 分别填写，不能把大类当作具体车型。若车型型号唯一对应已知品牌，请补全品牌；例如 Perodua Alza、北路大 Alza 的品牌为 Perodua、车型为 Alza、类别为 MPV。vehicle_category 应依据具体车型填写，不能只因车队未写类别就置空。
- 只提取明确资料，候选订单号仅用于核对，不能推断或编造原文中未出现的订单号；无法确定的字段填 null。
- 多笔订单分别输出，无法可靠归属的资料不要分配给其他订单；冲突或不确定时降低置信度。

只输出 JSON：{"records":[{"order_number":string|null,"driver_name":string|null,"driver_phone":string|null,"license_plate":string|null,"vehicle_category":string|null,"vehicle_brand":string|null,"vehicle_model":string|null,"confidence":"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}]}`;

function confidence(value: unknown): VehicleVision["confidence"] {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNKNOWN";
}

function fleetText(value: unknown, provider: FleetTextVision["provider"], note: string): FleetTextVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rows = Array.isArray(raw.records) ? raw.records : [];
  const text = (row: Record<string, unknown>, key: string) => typeof row[key] === "string" && row[key].trim() ? row[key].trim().slice(0, 160) : null;
  return { records: rows.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ order_number: text(row, "order_number"), driver_name: text(row, "driver_name"), driver_phone: text(row, "driver_phone"), license_plate: text(row, "license_plate"), vehicle_brand: text(row, "vehicle_brand"), vehicle_category: text(row, "vehicle_category"), vehicle_model: text(row, "vehicle_model"), confidence: confidence(row.confidence) }];
  }), provider, note };
}

function fleetPackage(value: unknown, provider: FleetPackageVision["provider"], note: string): FleetPackageVision {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rows = Array.isArray(raw.records) ? raw.records : [];
  const text = (row: Record<string, unknown>, key: string) => typeof row[key] === "string" && row[key].trim() ? row[key].trim().slice(0, 160) : null;
  const source = (value: unknown): FleetPackageVisionRecord["driver_name_source"] => value === "DRIVER_DETAILS" || value === "EWALLET_PAYEE" ? value : "UNKNOWN";
  const indexes = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0 && item <= 6))] : [];
  return { records: rows.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ order_number: text(row, "order_number"), driver_name: text(row, "driver_name"), driver_name_source: source(row.driver_name_source), driver_phone: text(row, "driver_phone"), license_plate: text(row, "license_plate"), vehicle_brand: text(row, "vehicle_brand"), vehicle_model: text(row, "vehicle_model"), vehicle_category: text(row, "vehicle_category"), vehicle_color: text(row, "vehicle_color"), confirmation_status: row.confirmation_status === "ACCEPTED" || row.confirmation_status === "PENDING_DETAILS" || row.confirmation_status === "DECLINED" ? row.confirmation_status : "UNKNOWN", source_image_indexes: indexes(row.source_image_indexes), confidence: confidence(row.confidence) }];
  }), provider, note };
}

export async function recognizeFleetPackage(rawText: string, imageUrls: string[], candidateOrderNumbers: string[]): Promise<FleetPackageVision> {
  if (!isAiVisionRealCallsEnabled()) return { records: [], provider: "NONE", note: "AI 实际调用尚未启用；已保存资料包草稿，等待人工补充。" };
  const content: QwenContent = [{ type: "text", text: `${fleetPackagePrompt}\n\n候选订单号：${candidateOrderNumbers.join("、")}\n\n本次提交原文：\n${rawText.slice(0, 12_000)}` }, ...imageUrls.slice(0, 6).map((url) => ({ type: "image_url" as const, image_url: { url } }))];
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  try {
    if (!key) throw new Error("GLM_NOT_CONFIGURED");
    const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content }], temperature: 0.1, reasoning_effort: "low", response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GLM_${response.status}`);
    const result = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof result !== "string") throw new Error("GLM_EMPTY_RESPONSE");
    return fleetPackage(JSON.parse(result.replace(/^```json\s*|\s*```$/g, "")), "GLM", "AI：GLM 联合识别资料包；仍需按字段核对。");
  } catch (reason) {
    try {
      return fleetPackage(await qwenJson<Record<string, unknown>>([{ role: "user", content }], AI_MODELS.vehicleVision.fallback.model, { timeoutMs: AI_MODELS.vehicleVision.fallback.timeoutMs }), "QWEN", `AI：Qwen 联合识别资料包（GLM ${failureReason(reason, "GLM")}）`);
    } catch (fallbackError) { return { records: [], provider: "NONE", note: `资料包识别未完成：${unavailableScreenshotNote(reason, fallbackError)}` }; }
  }
}

/**
 * Text replies use the same provider order as image recognition.  This is
 * intentionally separate from regular-expression parsing: rules may validate
 * an answer or provide a safe fallback, but never claim that an AI call ran.
 */
export async function recognizeFleetReplyText(rawText: string, candidateOrderNumbers: string[]): Promise<FleetTextVision> {
  if (!isAiVisionRealCallsEnabled()) return { records: [], provider: "NONE", note: "AI 实际调用尚未启用；已使用规则降级。" };
  const message = `${fleetTextPrompt}\n\n可匹配订单号：${candidateOrderNumbers.join("、")}\n\n车队原文：\n${rawText.slice(0, 12_000)}`;
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  try {
    if (!key) throw new Error("GLM_NOT_CONFIGURED");
    const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content: message }], temperature: 0.1, reasoning_effort: "low", response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GLM_${response.status}`);
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
    return fleetText(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "AI：GLM");
  } catch (reason) {
    try {
      return fleetText(await qwenJson<Record<string, unknown>>([{ role: "user", content: message }], AI_MODELS.vehicleVision.fallback.model, { timeoutMs: AI_MODELS.vehicleVision.fallback.timeoutMs }), "QWEN", `AI：Qwen（GLM 不可用：${failureReason(reason, "GLM")}）`);
    } catch (fallbackError) {
      return { records: [], provider: "NONE", note: `规则降级：${unavailableScreenshotNote(reason, fallbackError)}` };
    }
  }
}

export async function recognizeFleetScreenshot(imageUrl: string): Promise<ScreenshotVision> {
  if (!isAiVisionRealCallsEnabled()) return { records: [], provider: "NONE", note: "AI 实际调用尚未启用；请人工录入。" };
  const key = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY;
  try {
    if (!key) throw new Error("GLM_NOT_CONFIGURED");
    const response = await fetch(AI_MODELS.vehicleVision.primary.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: AI_MODELS.vehicleVision.primary.model, messages: [{ role: "user", content: [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }] }], temperature: 0.1, reasoning_effort: "low", response_format: { type: "json_object" } }), signal: AbortSignal.timeout(AI_MODELS.vehicleVision.primary.timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GLM_${response.status}`);
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("GLM_EMPTY_RESPONSE");
    return screenshot(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")), "GLM", "GLM 截图识别建议，需人工核对。");
  } catch (reason) {
    try {
      const content: QwenContent = [{ type: "text", text: screenshotPrompt }, { type: "image_url", image_url: { url: imageUrl } }];
      return screenshot(await qwenJson<Record<string, unknown>>([{ role: "user", content }], AI_MODELS.vehicleVision.fallback.model, { timeoutMs: AI_MODELS.vehicleVision.fallback.timeoutMs }), "QWEN", `GLM 不可用，已使用 Qwen 备用：${reason instanceof Error ? reason.message : "UNKNOWN"}`);
    } catch (fallbackError) { return { records: [], provider: "NONE", note: unavailableScreenshotNote(reason, fallbackError) }; }
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
