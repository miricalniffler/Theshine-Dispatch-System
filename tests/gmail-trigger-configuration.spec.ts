import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

test("30-minute configuration replaces duplicate Gmail timers without mutating sync state", () => {
  const source = readFileSync(resolve(process.cwd(), "apps-script/gmail-iway-sync/Code.gs"), "utf8");
  const properties: Record<string, string> = {
    IWAY_GMAIL_INGEST_URL: "https://dispatch.example/api/import-sync/gmail-iway",
    IWAY_GMAIL_INGEST_TOKEN: "test-token",
    IWAY_GMAIL_TARGET_ENVIRONMENT: "production",
    IWAY_GMAIL_OPERATIONS_URL: "https://dispatch.example/api/mail-operations/gmail",
    IWAY_GMAIL_OPERATIONS_TOKEN: "test-operations-token",
    IWAY_GMAIL_ENABLED_AT: "2026-11-14T00:00:00.000Z",
    IWAY_GMAIL_SEEN: "{\"kept\":1}",
    IWAY_GMAIL_SCAN_OFFSET: "150",
    IWAY_GMAIL_OPERATIONS_SEEN: "{\"ops-kept\":1}",
  };
  const before = { ...properties };
  const deleted: string[] = [];
  const created: Array<{ handler: string; minutes: number }> = [];
  type Trigger = { handler: string; getHandlerFunction: () => string };
  const trigger = (handler: string): Trigger => ({ handler, getHandlerFunction: () => handler });
  const triggers = [
    trigger("syncIwayGmailOrders"), trigger("syncIwayGmailOrders"),
    trigger("syncKualaLumpurMailOperations"), trigger("syncKualaLumpurMailOperations"),
    trigger("unrelatedTrigger"),
  ];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] || null, setProperty: (key: string, value: string) => { properties[key] = value; }, deleteProperty: (key: string) => { delete properties[key]; } }) },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (item: Trigger) => { deleted.push(item.handler); const index = triggers.indexOf(item); if (index >= 0) triggers.splice(index, 1); },
      newTrigger: (handler: string) => ({ timeBased: () => ({ everyMinutes: (minutes: number) => ({ create: () => { created.push({ handler, minutes }); } }) }) }),
    },
  };
  vm.runInNewContext(source, context);
  (context as any).configureIwayGmailThirtyMinuteTriggers();
  expect(deleted.sort()).toEqual(["syncIwayGmailOrders", "syncIwayGmailOrders", "syncKualaLumpurMailOperations", "syncKualaLumpurMailOperations"].sort());
  expect(created).toEqual([{ handler: "syncIwayGmailOrders", minutes: 30 }, { handler: "syncKualaLumpurMailOperations", minutes: 30 }]);
  expect(properties).toEqual(before);
});
