import { demoOrderRepository } from "@/features/orders/demo-repository";
import { success } from "@/lib/api-response";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { return success(await demoOrderRepository.getActivity((await params).id)); }
