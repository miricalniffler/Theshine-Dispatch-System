import { success } from "@/lib/api-response";
import { listFleetReplyDates } from "@/features/fleet-replies/service";

export async function GET() { return success(await listFleetReplyDates()); }
