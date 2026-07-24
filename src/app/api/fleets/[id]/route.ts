import { NextRequest, NextResponse } from "next/server";
import { fleetRepository } from "@/features/fleets/repository";
import { fleetInputSchema } from "@/features/fleets/validation";

type Params = { params: Promise<{ id: string }> };
export function GET(_: NextRequest, { params }: Params) {
  return params.then(({ id }) => {
    const fleet = fleetRepository.get(id);
    return fleet ? NextResponse.json({ data: fleet }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "未找到该车队", fields: [] } }, { status: 404 });
  });
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const result = fleetInputSchema.safeParse(await request.json());
  if (!result.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请检查填写内容", fields: result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) } }, { status: 422 });
  const { id } = await params;
  const fleet = fleetRepository.update(id, result.data);
  return fleet ? NextResponse.json({ data: fleet }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "未找到该车队", fields: [] } }, { status: 404 });
}
