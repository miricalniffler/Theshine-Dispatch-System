import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("Apps Script 中文 Gmail 每日额度错误返回配额代码，其他故障仍保持失败", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync("apps-script/gmail-iway-sync/Code.gs", "utf8"), context);
  // Exercise the deployed handler's error boundary without reading a mailbox.
  vm.runInContext(`
    PropertiesService = { getScriptProperties: function () { return {}; } };
    verifyManualTrigger_ = function () {};
    jsonResponse_ = function (value) { return JSON.stringify(value); };
    syncIwayGmailOrders = function () { throw new Error('一天调用次数过多的服务：gmail。'); };
  `, context);
  expect(JSON.parse(vm.runInContext("doPost({})", context))).toEqual({ status: "FAILED", code: "GMAIL_QUOTA_EXHAUSTED" });
  vm.runInContext("syncIwayGmailOrders = function () { throw new Error('temporary private diagnostic'); };", context);
  expect(JSON.parse(vm.runInContext("doPost({})", context))).toEqual({ status: "FAILED", code: "GMAIL_MANUAL_SYNC_FAILED" });
  expect(vm.runInContext("manualTriggerErrorCode_(new Error('Service invoked too many times for one day: gmail.'))", context)).toBe("GMAIL_QUOTA_EXHAUSTED");
  expect(vm.runInContext("manualTriggerErrorCode_({ message: '调用次数已达限额：\\u200egmail。', toString: function () { return 'Exception'; } })", context)).toBe("GMAIL_QUOTA_EXHAUSTED");
  expect(vm.runInContext("manualTriggerErrorCode_({ message: 'Exception', toString: function () { return 'Service invoked too many times for one day: gmail.'; } })", context)).toBe("GMAIL_QUOTA_EXHAUSTED");
  expect(vm.runInContext("manualTriggerErrorCode_(new Error('1 日にサービス gmail を実行した回数が多すぎます。'))", context)).toBe("GMAIL_QUOTA_EXHAUSTED");
});
