import { success } from "@/lib/api-response";
import { listDriverWork } from "@/features/iway/service";
export async function GET() { return success(await listDriverWork()); }
