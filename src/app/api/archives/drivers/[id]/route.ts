import { failure, success } from "@/lib/api-response";
import { updateDriverProfile } from "@/features/archives/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    return success(await updateDriverProfile((await params).id, body));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return failure(code || "DRIVER_UPDATE_FAILED", code === "INVALID_DRIVER_NAME" ? "司机显示姓名不能为空。" : "无法更新司机档案。", undefined, 422);
  }
}
