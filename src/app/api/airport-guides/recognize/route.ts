import { failure, success } from "@/lib/api-response";
import { activeAirportGuideCandidates } from "@/features/airport-guides/service";
import { recognizeAirportForOrder } from "@/features/airport-guides/matcher";

export const dynamic = "force-dynamic";

/** Foundation-only deterministic recognition endpoint. No AI and no side effects. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pickupAddress = searchParams.get("pickupAddress")?.trim();
  const dropoffAddress = searchParams.get("dropoffAddress")?.trim();
  if (!pickupAddress || !dropoffAddress) return failure("INVALID_REQUEST", "请提供接客地址和送达地址。", undefined, 422);
  return success({ recognition: recognizeAirportForOrder({ pickupAddress, dropoffAddress, guides: await activeAirportGuideCandidates() }) });
}
