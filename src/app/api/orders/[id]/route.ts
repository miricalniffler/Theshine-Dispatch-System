import { demoOrderRepository } from "@/features/orders/demo-repository";
import { failure, success } from "@/lib/api-response";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const order = await demoOrderRepository.getById((await params).id);
  return order ? success(order) : failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
}
