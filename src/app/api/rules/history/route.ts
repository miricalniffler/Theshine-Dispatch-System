import { failure, success } from "@/lib/api-response";
import { listRuleVersions } from "@/features/rules/repository";

export async function GET() {
  try {
    const versions = await listRuleVersions();
    return success({ versions: versions.map((item) => ({ ...item, publishedAt: item.publishedAt.toISOString() })) });
  } catch (error) {
    return failure("RULE_HISTORY_UNAVAILABLE", error instanceof Error ? error.message : "无法读取规则版本历史。", undefined, 500);
  }
}
