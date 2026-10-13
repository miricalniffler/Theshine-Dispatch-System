import { NextRequest, NextResponse } from "next/server";
import { type BenchmarkProvider, publicCatalog, resolveSelections } from "@/features/ai-benchmark/catalog";
import { runVisionBenchmark } from "@/features/ai-benchmark/providers";

export const maxDuration = 60;
export const runtime = "nodejs";

const maxImageBytes = 3 * 1024 * 1024;
const maxRequestBytes = 4_300_000;
const vehiclePrompt = `请独立分析这张车辆照片，严格基于可见证据回答。输出中文，明确区分：1. 品牌；2. 最可能的具体车型/车系；3. 可见的判断依据（前脸、车灯、车标、车身轮廓等）；4. 可能混淆的车型；5. 车辆类别（Sedan/SUV/Minivan/Van）；6. 对车型判断的信心（高/中/低）和不确定原因。不确定时必须明确说明，禁止猜测年份、准确座位数、行李容量或车辆许可。请用简洁文本回答。`;
const orderPrompt = `请严格逐字识别这张接送机订单截图中的信息，并按以下字段分行输出：订单号、乘客姓名、电话、航班、接送时间（保留原时区）、上车地址、下车地址、车型、成人、儿童、行李、其他备注。所有字段只能基于图片可见内容，不得凭空补全或翻译专名；无法辨识的写“无法确认”。保留原始拼写、号码和时间。`;

function reply(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function authorized(request: NextRequest) { return Boolean(process.env.TEAM_ACCESS_TOKEN && request.cookies.get("iway-team-access")?.value === process.env.TEAM_ACCESS_TOKEN); }
function requireAccess(request: NextRequest) { return authorized(request) ? null : reply({ error: "请先登录工作台。" }, 401); }

export async function GET(request: NextRequest) {
  const denied = requireAccess(request);
  return denied ?? reply({ providers: publicCatalog() });
}

export async function POST(request: NextRequest) {
  const denied = requireAccess(request);
  if (denied) return denied;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) return reply({ error: "图片不可超过 3 MB，请压缩后重试。" }, 413);
  const body = await request.json().catch(() => ({}));
  const image = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  const imageMatch = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  if (!imageMatch || imageMatch[1].length % 4 !== 0) return reply({ error: "请上传 JPG、PNG 或 WebP 图片。" }, 422);
  const bytes = Math.floor(imageMatch[1].length * 3 / 4) - (imageMatch[1].endsWith("==") ? 2 : imageMatch[1].endsWith("=") ? 1 : 0);
  if (bytes > maxImageBytes) return reply({ error: "图片不可超过 3 MB，请压缩后重试。" }, 413);
  const mode = body.mode === "order" ? "order" : body.mode === "vehicle" ? "vehicle" : null;
  if (!mode) return reply({ error: "无效测试类型。" }, 422);
  let selections;
  try { selections = resolveSelections(body.models); }
  catch (error) { return reply({ error: "所选模型或地域不在测试白名单中。", code: error instanceof Error ? error.message : "INVALID_MODEL_CONFIGURATION" }, 422); }
  const provider = body.provider;
  if (provider !== undefined && !["qwen", "deepseek", "glm"].includes(provider)) return reply({ error: "无效服务商。" }, 422);
  const selected = provider ? [selections[provider as BenchmarkProvider]] : Object.values(selections);
  const prompt = mode === "vehicle" ? vehiclePrompt : orderPrompt;
  const results = await Promise.all(selected.map((selection) => runVisionBenchmark(selection, image, prompt)));
  return reply({ mode, results });
}
