import { failure, success } from "@/lib/api-response";
import { recognizeDriverScreenshot } from "@/features/assist/driver-screenshot";
import { z } from "zod";

const requestSchema = z.object({ imageUrl: z.string().startsWith("data:image/").max(8_000_000) });

export async function POST(request: Request) {
  try {
    const { imageUrl } = requestSchema.parse(await request.json());
    return success(await recognizeDriverScreenshot(imageUrl));
  } catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_IMAGE", "请上传小于约 6MB 的图片。", undefined, 400);
    return failure("SCREENSHOT_RECOGNITION_FAILED", "截图识别暂时无法完成；请人工填写司机资料。", undefined, 502);
  }
}
