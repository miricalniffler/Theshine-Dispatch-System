import { failure, success } from "@/lib/api-response";
import { AirportGuideServiceError, airportGuideInputSchema, createAirportGuide, listAirportGuides } from "@/features/airport-guides/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return success({ guides: await listAirportGuides() });
}

export async function POST(request: Request) {
  const parsed = airportGuideInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "请检查机场名称、IATA、识别关键词和指引文字。", parsed.error.issues.map((issue) => issue.path.join(".")), 422);
  try { return success({ guide: await createAirportGuide(parsed.data) }, 201); }
  catch (error) { return error instanceof AirportGuideServiceError ? failure(error.code, error.message, undefined, error.code === "MATCH_CONFLICT" ? 409 : 400) : failure("CREATE_FAILED", "创建机场指引失败。", undefined, 500); }
}
