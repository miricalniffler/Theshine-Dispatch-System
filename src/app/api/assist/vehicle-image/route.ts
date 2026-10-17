import { failure, success } from "@/lib/api-response";
import { recognizeVehicleImage } from "@/features/assist/driver-screenshot";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "@/lib/team-access";
import { z } from "zod";

// Never proxy arbitrary URLs, SVG, or HTML to an AI provider.  The UI sends a
// browser-created raster data URL and the image is not written to the database.
const requestSchema = z.object({ imageUrl: z.string().regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i).max(8_000_000) });

export async function POST(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try {
    const { imageUrl } = requestSchema.parse(await request.json());
    return success(await recognizeVehicleImage(imageUrl));
  } catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_IMAGE", "请上传小于约 6MB 的图片文件。", undefined, 400);
    return failure("VEHICLE_RECOGNITION_FAILED", "车辆识别暂时无法完成；请人工核对。", undefined, 502);
  }
}
