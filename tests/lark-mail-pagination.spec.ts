import { expect, test } from "@playwright/test";
import { fetchAllTriagePages } from "../scripts/lark-mail-pagination.mjs";

test("飞书邮件积压超过 200 封时会沿分页令牌读取全部摘要", () => {
  const calls: string[][] = [];
  const result = fetchAllTriagePages((args: string[]) => {
    calls.push(args);
    const page = calls.length;
    return {
      messages: Array.from({ length: 150 }, (_, index) => ({ message_id: `${page}-${index}` })),
      count: 150,
      has_more: page < 3,
      page_token: page < 3 ? `cursor-${page}` : "",
    };
  }, { mailbox: "orders@example.com", sender: "control@iwayex.com", pageSize: 150 });

  expect(result.messages).toHaveLength(450);
  expect(result.count).toBe(450);
  expect(calls).toHaveLength(3);
  expect(calls[1]).toContain("cursor-1");
  expect(calls[2]).toContain("cursor-2");
});

test("分页响应损坏或令牌重复时失败，不能将不完整读取报告为成功", () => {
  expect(() => fetchAllTriagePages(() => ({ messages: [], has_more: true, page_token: "same" }), {
    mailbox: "orders@example.com", sender: "control@iwayex.com",
  })).toThrow(/重复/);

  expect(() => fetchAllTriagePages(() => ({ has_more: false }), {
    mailbox: "orders@example.com", sender: "control@iwayex.com",
  })).toThrow(/messages 数组/);
});
