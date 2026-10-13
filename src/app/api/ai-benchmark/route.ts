import { NextRequest, NextResponse } from "next/server";
import { type BenchmarkProvider, publicCatalog, resolveSelections } from "@/features/ai-benchmark/catalog";
import { runVisionBenchmark } from "@/features/ai-benchmark/providers";

export const maxDuration = 60;
export const runtime = "nodejs";

const maxImageBytes = 3 * 1024 * 1024;
const maxRequestBytes = 4_300_000;
const vehiclePrompt = `请识别照片中的车辆，只输出以下四行，不要标题、序号、Markdown、推理过程或额外解释：\n品牌：<品牌中文名或无法确认>\n车型：<最可能的具体车型/车系，无法确认则写无法确认>\n车辆类别：<Sedan/SUV/Minivan/Van/无法确认>\n置信度：<高/中/低>\n严格依据可见证据，不需要识别车辆代际、生产年份或具体配置；不要猜测准确座位数、行李容量或车辆许可。`;
const orderPrompt = `请识别接送机订单或泰国车队信息截图，准确读取泰文、英文、中文及数字混排内容。请分行输出图片中出现的字段：订单号、乘客姓名、乘客电话、航班、接送时间（保留原时区）、上车地址、下车地址、车型、成人、儿童、行李、司机姓名（英文）、司机姓名状态、司机电话、车牌号码、其他备注。\n泰文标签提示：ชื่อ / ชื่อคนขับ / คนขับ 可能表示司机姓名，เบอร์โทร / โทร 表示电话，ทะเบียน / ทะเบียนรถ 表示车牌；须根据上下文区分司机与乘客。\n司机姓名如有泰文，准确转写成英文拉丁字母，不显示泰文原名；已有英文姓名则原样保留。音译可能有多种拼法，无法准确辨认时标注待核实，不能把猜测标成已确认。\n如截图确实没有提供司机姓名，从 Somchai、Somsak、Prasert、Anan 等常见泰国男性名字中任选一个作为实际使用的英文司机显示名，必须同时输出“司机姓名状态：系统生成”，以便管理平台醒目标识其来源。如图片有可识别的真实司机姓名，输出“司机姓名状态：图片提供（英文转写，待核实拼写）”。系统生成的姓名可作为司机显示名使用，但不代表司机法定姓名或已核实身份；若外部平台要求真实或法定姓名，不得冒充真实身份。\n车牌保留泰文字母、数字及其原始顺序，不得音译或替换；电话号码和时间逐字保留。除明确允许的系统生成司机显示名外，不得补造任何字段；其他看不清的字段写“无法确认”。`;

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
