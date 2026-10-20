import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import "dotenv/config";

// This LaunchAgent is deliberately a mailbox reader only. It has no Prisma
// client and no database URL: all classification, idempotency, audit records
// and order mutations happen in the authenticated website endpoint.
const cli = process.env.LARK_CLI_PATH || "/Users/muzitong/.local/bin/lark-cli";
const mailbox = process.env.IWAY_MAILBOX || "dingdan@theshine.com.cn";
const ingestUrl = process.env.IWAY_LOCAL_SYNC_INGEST_URL?.trim();
const ingestToken = process.env.IWAY_LOCAL_SYNC_INGEST_TOKEN?.trim();
const enabledAtRaw = process.env.IWAY_LOCAL_SYNC_ENABLED_AT;
const enabledAt = enabledAtRaw ? new Date(enabledAtRaw) : null;
const dryRun = process.argv.includes("--dry-run");
const officialSenders = ["control@iwayex.com", "noreply@iway.ru"];
const cliTimeoutMs = 75_000;

if (!enabledAt || Number.isNaN(enabledAt.getTime())) {
  throw new Error("本机同步助手尚未设置有效的 IWAY_LOCAL_SYNC_ENABLED_AT 水位线；为避免回放历史邮件，已拒绝启动。");
}
if (!dryRun && (!ingestUrl || !/^https:\/\//.test(ingestUrl) || !ingestToken)) {
  throw new Error("本机同步助手未配置安全的网站提交地址或专用令牌；为避免绕过统一邮件规则，已拒绝启动。");
}

function runCli(args) {
  const result = spawnSync(cli, args, {
    cwd: "/Users/muzitong/Documents/帮我装的程序",
    encoding: "utf8",
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || "/usr/bin:/bin"}`, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    maxBuffer: 32 * 1024 * 1024,
    timeout: cliTimeoutMs,
    killSignal: "SIGTERM",
  });
  if (result.error) throw new Error(`lark-cli 执行失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `lark-cli exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function validDate(value) { const date = new Date(value); return !Number.isNaN(date.getTime()) ? date : null; }

async function readNewMail() {
  const triages = officialSenders.map((sender) => ({ sender, result: runCli([
    "mail", "+triage", "--as", "user", "--mailbox", mailbox,
    "--filter", JSON.stringify({ from: [sender] }), "--max", "30", "--format", "json",
  ]) }));
  const messages = [...new Map(triages.flatMap(({ sender, result }) => (result.messages || []).map((mail) => [mail.message_id, { ...mail, sourceSender: sender }]))).values()]
    .filter((mail) => validDate(mail.date)?.getTime() >= enabledAt.getTime());
  if (!messages.length) return { scanned: triages.reduce((total, item) => total + Number(item.result.count || 0), 0), items: [] };
  const details = runCli([
    "mail", "+messages", "--as", "user", "--mailbox", mailbox,
    "--message-ids", messages.map((mail) => mail.message_id).join(","), "--html=false", "--format", "json",
  ]);
  const metadata = new Map(messages.map((mail) => [mail.message_id, mail]));
  const items = (details.data?.messages || []).flatMap((message) => {
    const meta = metadata.get(message.message_id);
    const receivedAt = validDate(meta?.date);
    const text = typeof message.body_plain_text === "string" ? message.body_plain_text : "";
    if (!meta || !receivedAt || !text.trim()) return [];
    return [{ id: message.message_id, text, subject: String(meta.subject || ""), sender: String(meta.from || meta.sender || meta.sourceSender || ""), receivedAt: receivedAt.toISOString() }];
  });
  return { scanned: triages.reduce((total, item) => total + Number(item.result.count || 0), 0), items };
}

async function main() {
  const { scanned, items } = await readNewMail();
  if (dryRun) {
    // Deliberately do not print mail text, passenger details, or credentials.
    console.log(JSON.stringify({ mode: "read-only", scanned, submittedCandidates: items.map((item) => ({ id: item.id, sender: item.sender, subject: item.subject, receivedAt: item.receivedAt })) }, null, 2));
    return;
  }
  if (!items.length) { console.log(JSON.stringify({ status: "ok", scanned, submitted: 0 })); return; }
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${ingestToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items }), signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`网站统一邮件处理服务返回 HTTP ${response.status}`);
  const result = await response.json();
  if (!result?.ok) throw new Error(result?.error?.message || "网站统一邮件处理服务未确认成功");
  console.log(JSON.stringify({ status: "ok", scanned, submitted: items.length, summary: result.data }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : "未知错误" }));
  process.exitCode = 1;
});
