import { expect, test } from "@playwright/test";
import { getGmailManualTriggerStatus, gmailManualTriggerAvailable, gmailManualTriggerReady, triggerManualGmailSync } from "../src/features/import/gmail-manual-trigger";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("手动 Gmail 同步只接受受限的 Apps Script HTTPS 地址，且未配置时不会伪报可用", () => {
  const url = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const secret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  try {
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://example.com/trigger";
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "test-secret";
    expect(gmailManualTriggerReady()).toBeFalsy();
    delete process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
    expect(gmailManualTriggerReady()).toBeFalsy();
  } finally {
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", url);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", secret);
  }
});

test("手动 Gmail 同步只在 Apps Script 返回最终成功后报告完成，并保留配额失败", async () => {
  const url = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const secret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  try {
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "test-secret";
    const completed = await triggerManualGmailSync(async () => new Response(JSON.stringify({ status: "SUCCEEDED", summary: { created: 1, skipped: 2 } }), { status: 200 }) as Response);
    expect(completed).toEqual({ kind: "completed", created: 1, cancelled: 0, review: 0, skipped: 2, rejected: 0 });
    const quota = await triggerManualGmailSync(async () => new Response(JSON.stringify({ status: "FAILED", code: "GMAIL_QUOTA_EXHAUSTED" }), { status: 200 }) as Response);
    expect(quota).toMatchObject({ kind: "failed", code: "GMAIL_QUOTA_EXHAUSTED", message: "Gmail 配额不足，同步失败。" });
  } finally {
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", url);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", secret);
  }
});

test("运营邮件手动同步使用独立签名动作，并返回 Apps Script 最近成功时间", async () => {
  const url = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const secret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  try {
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "test-secret";
    let body = "";
    const result = await triggerManualGmailSync(async (_input, init) => {
      body = String(init?.body || "");
      return new Response(JSON.stringify({ status: "SUCCEEDED", summary: { created: 2, skipped: 1 }, latestSuccessAt: "2026-11-15T00:00:00.000Z" }), { status: 200 }) as Response;
    }, "operations");
    expect(JSON.parse(body)).toMatchObject({ action: "operations" });
    expect(result).toEqual({ kind: "completed", created: 2, cancelled: 0, review: 0, skipped: 1, rejected: 0, latestSuccessAt: "2026-11-15T00:00:00.000Z" });
  } finally {
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", url);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", secret);
  }
});

test("只有签名状态探针确认 Apps Script 已部署后，首页才可启用手动同步", async () => {
  const url = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const secret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  try {
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "test-secret";
    expect(await gmailManualTriggerAvailable(async () => new Response(JSON.stringify({ status: "READY" }), { status: 200 }) as Response)).toBeTruthy();
    expect(await gmailManualTriggerAvailable(async () => new Response(JSON.stringify({ status: "UNAVAILABLE" }), { status: 200 }) as Response)).toBeFalsy();
  } finally {
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", url);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", secret);
  }
});

test("签名状态探针只返回可用状态和最近成功时间", async () => {
  const url = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const secret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  try {
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
    process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "test-secret";
    const status = await getGmailManualTriggerStatus(async () => new Response(JSON.stringify({ status: "READY", latestOrderSuccessAt: "2026-11-14T23:00:00Z", latestOperationsSuccessAt: "2026-11-14T22:30:00Z" }), { status: 200 }) as Response);
    expect(status).toEqual({ available: true, latestOrderSuccessAt: "2026-11-14T23:00:00Z", latestOperationsSuccessAt: "2026-11-14T22:30:00Z" });
  } finally {
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", url);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", secret);
  }
});
