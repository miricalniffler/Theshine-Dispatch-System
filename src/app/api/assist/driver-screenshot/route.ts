import { failure, success } from "@/lib/api-response";
import { recognizeDriverScreenshot } from "@/features/assist/driver-screenshot";
import { z } from "zod";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "@/lib/team-access";

// Only accept an uploaded raster image data URL; do not forward arbitrary
// remote locations or active SVG content to an external provider.
const requestSchema = z.object({ imageUrl: z.string().regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i).max(8_000_000) });

export async function POST(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try {
    const { imageUrl } = requestSchema.parse(await request.json());
    return success(await recognizeDriverScreenshot(imageUrl));
  } catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_IMAGE", "请上传小于约 6MB 的图片。", undefined, 400);
    return failure("SCREENSHOT_RECOGNITION_FAILED", "截图识别暂时无法完成；请人工填写司机资料。", undefined, 502);
  }
}
