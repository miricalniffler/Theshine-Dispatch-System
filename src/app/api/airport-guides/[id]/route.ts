import { failure, success } from "@/lib/api-response";
import { AirportGuideServiceError, airportGuideInputSchema, getAirportGuide, updateAirportGuide } from "@/features/airport-guides/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const guide = await getAirportGuide((await params).id);
  return guide ? success({ guide }) : failure("NOT_FOUND", "找不到机场指引。", undefined, 404);
}

export async function PUT(request: Request, { params }: Params) {
  const parsed = airportGuideInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "请检查机场指引内容。", parsed.error.issues.map((issue) => issue.path.join(".")), 422);
  try { return success({ guide: await updateAirportGuide((await params).id, parsed.data) }); }
  catch (error) { return error instanceof AirportGuideServiceError ? failure(error.code, error.message, undefined, error.code === "NOT_FOUND" ? 404 : error.code === "MATCH_CONFLICT" ? 409 : 400) : failure("UPDATE_FAILED", "更新机场指引失败。", undefined, 500); }
}
