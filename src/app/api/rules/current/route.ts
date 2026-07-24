import { loadRules, loadRulesSource } from "@/lib/rules/load-rules";
import { success } from "@/lib/api-response";

export async function GET() {
  const rules = loadRules();
  return success({ source: loadRulesSource(), version: rules.rules_version });
}
