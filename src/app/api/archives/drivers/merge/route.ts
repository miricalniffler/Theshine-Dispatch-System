import { failure, success } from "@/lib/api-response";
import { mergeDriverProfiles } from "@/features/archives/service";
export async function POST(request: Request) { try { const body = await request.json(); const result = await mergeDriverProfiles(String(body.sourceProfileId || ""), String(body.targetProfileId || "")); return result.merged ? success(result) : failure("PHONE_CONFLICT", `手机号冲突：${result.conflicts.join("、")}。请人工核对后再合并。`, undefined, 409); } catch { return failure("MERGE_FAILED", "无法合并司机档案；请确认两份档案仍有效。", undefined, 422); } }
