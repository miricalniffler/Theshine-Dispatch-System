import { success } from "@/lib/api-response";
import { listReplyContexts } from "@/features/fleet-replies/service";

export async function GET() { return success(await listReplyContexts()); }
