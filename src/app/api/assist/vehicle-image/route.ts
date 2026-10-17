import { failure, success } from "@/lib/api-response";
import { recognizeDriverScreenshot } from "@/features/assist/driver-screenshot";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "@/lib/team-access";
import { z } from "zod";

const requestSchema = z.object({ imageUrl: z.string().startsWith("data:image/").max(8_000_000) });

export async function POST(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try {
    const { imageUrl } = requestSchema.parse(await request.json());
    return success(await recognizeDriverScreenshot(imageUrl));
  } catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_IMAGE", "请上传小于约 6MB 的图片文件。", undefined, 400);
    return failure("VEHICLE_RECOGNITION_FAILED", "车辆识别暂时无法完成；请人工核对。", undefined, 502);
  }
}
