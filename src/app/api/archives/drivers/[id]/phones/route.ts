import { failure, success } from "@/lib/api-response";
import { addDriverPhone } from "@/features/archives/service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const body = await request.json(); return success(await addDriverPhone((await params).id, String(body.rawPhone || ""))); } catch (error) { const code = error instanceof Error ? error.message : ""; return failure(code || "PHONE_SAVE_FAILED", code === "DRIVER_PHONE_CONFLICT" ? "该手机号已关联到另一位有效司机，需先人工核对。" : "手机号格式不正确。", undefined, 422); } }
