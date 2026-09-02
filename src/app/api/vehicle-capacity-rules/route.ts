import { failure, success } from "@/lib/api-response";
import { capacityRuleInputSchema, listVehicleCapacityRules, saveVehicleCapacityRule } from "@/features/customer-notifications/service";

export async function GET() { return success({ rules: await listVehicleCapacityRules() }); }
export async function POST(request: Request) {
  const parsed = capacityRuleInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "请检查车型承载规则。", parsed.error.issues.map((issue) => issue.path.join(".")), 422);
  return success({ rule: await saveVehicleCapacityRule(parsed.data) });
}
