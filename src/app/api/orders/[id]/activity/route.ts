import { findPersistedOrder } from "@/features/orders/sqlite-repository";
import { success } from "@/lib/api-response";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const order = await findPersistedOrder((await params).id); return success(order?.activityLogs.map((item) => ({ action: item.action, at: item.createdAt, metadata: item.metadata })) ?? []); }
