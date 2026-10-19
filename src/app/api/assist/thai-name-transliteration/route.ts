import { failure, success } from "@/lib/api-response";
import { findConfirmedEnglishDriverNames, transliterateThaiDriverNames } from "@/features/assist/service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.names) || !body.names.every((name: unknown) => typeof name === "string")) return failure("INVALID_REQUEST", "请提供泰文司机姓名。", undefined, 422);
  const confirmed = await findConfirmedEnglishDriverNames(body.names);
  const remaining = body.names.filter((name: string) => !confirmed.has(name.trim()));
  const result = await transliterateThaiDriverNames(remaining);
  const names = new Map([...confirmed, ...result.names]);
  const message = confirmed.size
    ? `${result.message} 已优先复用 ${confirmed.size} 个已确认的历史英文姓名。`
    : result.message;
  return success({ status: names.size ? "SUGGESTION_READY" : result.status, message, names: [...names.entries()].map(([thai, english]) => ({ thai, english })) });
}
