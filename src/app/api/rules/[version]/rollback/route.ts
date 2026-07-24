import { failure, success } from "@/lib/api-response";
import { rollbackRuleVersion } from "@/features/rules/repository";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  const body = await request.json().catch(() => ({}));
  if (body.publishedBy !== undefined && typeof body.publishedBy !== "string") return failure("INVALID_REQUEST", "发布人格式不正确。", undefined, 422);
  try {
    const version = await rollbackRuleVersion((await params).version, body.publishedBy);
    return success({ ...version, publishedAt: version.publishedAt.toISOString() }, 201);
  } catch (error) {
    return failure("RULE_ROLLBACK_FAILED", error instanceof Error ? error.message : "规则回退失败。", undefined, 422);
  }
}
