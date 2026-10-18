import { failure, success } from "@/lib/api-response";
import { transliterateThaiDriverNames } from "@/features/assist/service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.names) || !body.names.every((name: unknown) => typeof name === "string")) return failure("INVALID_REQUEST", "请提供泰文司机姓名。", undefined, 422);
  const result = await transliterateThaiDriverNames(body.names);
  return success({ status: result.status, message: result.message, names: [...result.names.entries()].map(([thai, english]) => ({ thai, english })) });
}
