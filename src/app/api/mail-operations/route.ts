import { success } from "@/lib/api-response";
import { db } from "@/lib/db";
export async function GET() { const data = await db.mailOperationMessage.findMany({ where: { city: "吉隆坡" }, select: { id: true, subject: true, sender: true, receivedAt: true, category: true, status: true, order: { select: { platformOrderNumber: true } } }, orderBy: { receivedAt: "desc" }, take: 200 }); return success(data); }
