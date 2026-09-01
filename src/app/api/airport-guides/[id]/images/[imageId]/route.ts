import { failure, success } from "@/lib/api-response";
import { AirportGuideServiceError } from "@/features/airport-guides/service";
import { removeAirportGuideImage } from "@/features/airport-guides/upload-service";

type Params = { params: Promise<{ id: string; imageId: string }> };

export async function DELETE(_: Request, { params }: Params) {
  const { id, imageId } = await params;
  try { await removeAirportGuideImage(id, imageId); return success({ deleted: true }); }
  catch (error) { return error instanceof AirportGuideServiceError ? failure(error.code, error.message, undefined, error.code === "IMAGE_NOT_FOUND" ? 404 : 422) : failure("IMAGE_DELETE_FAILED", "图片删除失败。", undefined, 500); }
}
