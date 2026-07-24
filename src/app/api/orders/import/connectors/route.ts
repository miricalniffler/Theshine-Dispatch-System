import { failure, success } from "@/lib/api-response";
import { listConnectorStatus, pullConnectorMessages, type ImportConnectorId } from "@/features/import/connectors";
import { NextRequest } from "next/server";

const validIds = new Set<ImportConnectorId>(["feishu-mail", "esforty"]);

export async function GET() {
  return success({ connectors: listConnectorStatus() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!validIds.has(body.connectorId)) return failure("INVALID_CONNECTOR", "请选择飞书邮件或 esforty。", undefined, 422);
  try {
    return success(await pullConnectorMessages(body.connectorId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入接入失败。";
    const code = error instanceof Error && error.name === "CONNECTOR_NOT_CONFIGURED" ? "CONNECTOR_NOT_CONFIGURED" : "CONNECTOR_PULL_FAILED";
    return failure(code, message, undefined, code === "CONNECTOR_NOT_CONFIGURED" ? 422 : 502);
  }
}
