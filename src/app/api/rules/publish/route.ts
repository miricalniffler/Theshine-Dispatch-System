import { failure, success } from "@/lib/api-response";
import { publishRuleVersion } from "@/features/rules/repository";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.source !== "string") return failure("INVALID_REQUEST", "请提供规则内容。", undefined, 422);
  if (body.publishedBy !== undefined && typeof body.publishedBy !== "string") return failure("INVALID_REQUEST", "发布人格式不正确。", undefined, 422);

  try {
    const version = await publishRuleVersion(body.source, body.publishedBy);
    return success({ ...version, publishedAt: version.publishedAt.toISOString() }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则发布失败。";
    const status = message.includes("已存在") ? 409 : 422;
    return failure("RULE_PUBLISH_FAILED", message, undefined, status);
  }
}
