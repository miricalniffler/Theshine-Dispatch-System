import { failure, success } from "@/lib/api-response";
import { getCustomerCommunication, prepareDriverNotificationForOrder, prepareFirstContact, previewFirstContact } from "@/features/customer-notifications/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return success(await getCustomerCommunication((await params).id));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const orderId = (await params).id;
  const body = await request.json().catch(() => ({}));
  if (body.action === "preview-first-contact") return success(await previewFirstContact(orderId, typeof body.oneOffText === "string" ? body.oneOffText : undefined));
  if (body.action === "prepare-first-contact") return success(await prepareFirstContact(orderId, { oneOffText: typeof body.oneOffText === "string" ? body.oneOffText : undefined, regenerate: body.regenerate === true }));
  if (body.action === "prepare-driver-info") return success(await prepareDriverNotificationForOrder(orderId));
  return failure("INVALID_REQUEST", "无法识别客户沟通操作。", undefined, 422);
}
