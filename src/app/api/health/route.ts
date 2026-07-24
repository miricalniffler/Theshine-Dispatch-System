import { success } from "@/lib/api-response";
import { loadRules } from "@/lib/rules/load-rules";

export const dynamic = "force-dynamic";

export async function GET() {
  const rules = loadRules();
  return success({ status: "ok", rulesVersion: rules.rules_version, checkedAt: new Date().toISOString() });
}
