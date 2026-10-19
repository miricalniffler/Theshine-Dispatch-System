import { expect, test } from "@playwright/test";
import { filterFeishuMailItems, type ImportedMessage } from "../src/features/import/connectors";

function mail(overrides: Partial<ImportedMessage>): ImportedMessage {
  return { id: "mail-1", text: "order text", action: "upsert", sender: "noreply@iway.ru", subject: "New ride #949810", ...overrides };
}

test("飞书桥接仅接收 iWay 官方发件人，但接受现有订单、修改和取消主题", () => {
  const accepted = filterFeishuMailItems([
    mail({ id: "new", subject: "New ride #949810" }),
    mail({ id: "transfer", sender: "iWay Control <control@iwayex.com>", subject: "Transfer service order #949811" }),
    mail({ id: "change", subject: "AMENDMENT to the transfer #949812" }),
    mail({ id: "cancel", subject: "Cancellation of transfer #949813" }),
    mail({ id: "other-sender", sender: "other@example.com" }),
    mail({ id: "other-subject", subject: "Weekly newsletter" }),
  ], ["control@iwayex.com", "noreply@iway.ru"]);
  expect(accepted.map((item) => item.id)).toEqual(["new", "transfer", "change", "cancel"]);
});
