import { z } from "zod";
import { failure, success } from "@/lib/api-response";
import { listRegionNotificationSettings, updateRegionNotificationSetting } from "@/features/airport-guides/service";

const updateSchema = z.object({ region: z.string().trim().min(1).max(80), customerWhatsAppEnabled: z.boolean() });
export const dynamic = "force-dynamic";

export async function GET() { return success({ settings: await listRegionNotificationSettings() }); }
export async function PUT(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "区域和开关值不正确。", undefined, 422);
  return success({ setting: await updateRegionNotificationSetting(parsed.data.region, parsed.data.customerWhatsAppEnabled) });
}
