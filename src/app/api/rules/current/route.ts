import { failure, success } from "@/lib/api-response";
import { ensureCurrentRuleVersion } from "@/features/rules/repository";

export async function GET() {
  try {
    const current = await ensureCurrentRuleVersion();
    return success({ source: current.yamlContent, version: current.version, publishedAt: current.publishedAt.toISOString() });
  } catch (error) {
    return failure("RULE_CURRENT_UNAVAILABLE", error instanceof Error ? error.message : "无法读取当前规则。", undefined, 500);
  }
}
