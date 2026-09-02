import { failure, success } from "@/lib/api-response";
import { ingestCustomerReply } from "@/features/customer-notifications/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.rawText !== "string" || !body.rawText.trim()) return failure("INVALID_REQUEST", "请录入客人的原始回复。", undefined, 422);
  try { return success(await ingestCustomerReply({ orderId: (await params).id, rawText: body.rawText, senderPhone: typeof body.senderPhone === "string" ? body.senderPhone : undefined })); }
  catch (error) { return failure("REPLY_INGEST_FAILED", error instanceof Error && error.message === "EMPTY_REPLY" ? "请录入客人的原始回复。" : "无法保存客人回复。", undefined, 422); }
}
