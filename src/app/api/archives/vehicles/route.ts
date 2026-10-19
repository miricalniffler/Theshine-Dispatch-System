import { success } from "@/lib/api-response";
import { listVehicleProfiles } from "@/features/archives/service";
export async function GET(request: Request) { return success(await listVehicleProfiles(new URL(request.url).searchParams.get("q") || "")); }
