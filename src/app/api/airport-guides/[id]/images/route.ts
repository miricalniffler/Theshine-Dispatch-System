import { failure, success } from "@/lib/api-response";
import { AirportGuideServiceError } from "@/features/airport-guides/service";
import { uploadAirportGuideImages } from "@/features/airport-guides/upload-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const form = await request.formData().catch(() => null);
  const files = form ? form.getAll("images").filter((entry): entry is File => entry instanceof File) : [];
  try { return success({ images: await uploadAirportGuideImages((await params).id, files) }, 201); }
  catch (error) { return error instanceof AirportGuideServiceError ? failure(error.code, error.message, undefined, error.code === "NOT_FOUND" ? 404 : 422) : failure("IMAGE_UPLOAD_FAILED", "图片上传失败。", undefined, 500); }
}
