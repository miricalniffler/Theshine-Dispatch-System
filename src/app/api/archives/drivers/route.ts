import { failure, success } from "@/lib/api-response";
import { listDriverProfiles } from "@/features/archives/service";
export async function GET(request: Request) { return success(await listDriverProfiles(new URL(request.url).searchParams.get("q") || "")); }
