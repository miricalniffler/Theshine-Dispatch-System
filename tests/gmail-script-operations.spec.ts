import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

test("Apps Script operations sync unwraps the API result and records success only after import", () => {
  const source = readFileSync(resolve(process.cwd(), "apps-script/gmail-iway-sync/Code.gs"), "utf8");
  const properties: Record<string, string> = {
    IWAY_GMAIL_OPERATIONS_URL: "https://dispatch.example/api/mail-operations/gmail",
    IWAY_GMAIL_OPERATIONS_TOKEN: "server-side-token",
    IWAY_GMAIL_OPERATIONS_SEEN: "{}",
  };
  let request: { url: string; options: Record<string, unknown> } | null = null;
  const mail = {
    getId: () => "iway-message-1",
    getFrom: () => "iWay <control@iwayex.com>",
    getSubject: () => "Complaint about Kuala Lumpur pickup",
    getPlainBody: () => "The driver was late for the pickup in Kuala Lumpur.",
    getDate: () => new Date("2026-11-14T12:00:00.000Z"),
  };
  const thread = { getId: () => "thread-1", getMessages: () => [mail] };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] || null, setProperty: (key: string, value: string) => { properties[key] = value; }, deleteProperty: (key: string) => { delete properties[key]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    GmailApp: { search: () => [thread] },
    UrlFetchApp: { fetch: (url: string, options: Record<string, unknown>) => { request = { url, options }; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ data: { created: 1, skipped: 2 } }) }; } },
  };
  vm.runInNewContext(source, context);
  const result = (context as any).syncKualaLumpurMailOperations();
  expect(result.status).toBe("SUCCEEDED");
  expect(result.summary.created).toBe(1);
  expect(result.summary.skipped).toBe(2);
  expect(Date.parse(result.latestSuccessAt)).toBeGreaterThan(0);
  expect(request?.url).toBe("https://dispatch.example/api/mail-operations/gmail");
  expect((request?.options.headers as Record<string, string>).Authorization).toBe("Bearer server-side-token");
  expect(JSON.parse(properties.IWAY_GMAIL_OPERATIONS_SEEN)).toHaveProperty("iway-message-1");
  expect(properties.IWAY_GMAIL_OPERATIONS_LAST_SUCCESS_AT).toBe(result.latestSuccessAt);
});
