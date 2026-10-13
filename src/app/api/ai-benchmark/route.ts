import { NextRequest, NextResponse } from "next/server";
import { type BenchmarkProvider, publicCatalog, resolveSelections } from "@/features/ai-benchmark/catalog";
import { runVisionBenchmark } from "@/features/ai-benchmark/providers";

export const maxDuration = 60;
export const runtime = "nodejs";

const maxImageBytes = 3 * 1024 * 1024;
const maxRequestBytes = 4_300_000;
const vehiclePrompt = `请识别照片中的车辆，只输出以下四行，不要标题、序号、Markdown、推理过程或额外解释：\n品牌：<品牌中文名或无法确认>\n车型：<最可能的具体车型/车系，无法确认则写无法确认>\n车辆类别：<Sedan/SUV/Minivan/Van/无法确认>\n置信度：<高/中/低>\n严格依据可见证据，不需要识别车辆代际、生产年份或具体配置；不要猜测准确座位数、行李容量或车辆许可。`;
const orderPrompt = `请对接送机订单或车队司机信息截图进行多语言文字识别（OCR），必须完整识别泰文、英文、中文以及混合文字和数字。先忠实逐字提取原文，再整理字段，不得跳过泰文字段、猜测姓名或擅自翻译、音译、改写专名。\n按图片实际出现的内容输出：订单号、乘客姓名、乘客电话、航班、接送时间（保留原时区）、上车地址、下车地址、车型、成人、儿童、行李、司机姓名（保留泰文原文）、司机电话、车牌号码（保留泰文字母与数字）、其他备注。\n特别注意泰文标签：ชื่อ / ชื่อคนขับ / คนขับ 常表示姓名或司机，เบอร์โทร / โทร 表示电话，ทะเบียน / ทะเบียนรถ 表示车牌。根据上下文判断是司机还是乘客，无法判断身份时放在其他备注中，不得擅自归类。车牌中的泰文字母与数字必须保持原样。\n仅输出图片中确实可见的字段，每个字段单独一行；无法辨认的内容标注“无法确认”，不要用相似字母替代。对于混合泰文和英文的姓名、地点及号码，保留原始拼写、空格、符号与数字；不要编造图片未提供的信息。`;

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
  if (provider !== undefined && !["auto", "qwen", "deepseek", "glm"].includes(provider)) return reply({ error: "无效服务商。" }, 422);
  const prompt = mode === "vehicle" ? vehiclePrompt : orderPrompt;
  if (provider === "auto") {
    const primary = await runVisionBenchmark(selections.glm, image, prompt, 30_000);
    if (primary.status === "ok") return reply({ mode, results: [primary], fallbackUsed: false });
    const backup = await runVisionBenchmark(selections.qwen, image, prompt, 30_000);
    return reply({ mode, results: [primary, backup], fallbackUsed: true });
  }
  const selected = provider ? [selections[provider as BenchmarkProvider]] : [selections.glm, selections.qwen];
  const results = await Promise.all(selected.map((selection) => runVisionBenchmark(selection, image, prompt)));
  return reply({ mode, results });
}
