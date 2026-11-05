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

test("分页重叠的邮件只保留一次，且缺失 ID 不得悄悄跳过", () => {
  let call = 0;
  const result = fetchAllTriagePages(() => {
    call++;
    return call === 1
      ? { messages: [{ message_id: "a" }, { message_id: "b" }], has_more: true, page_token: "next" }
      : { messages: [{ message_id: "b" }, { message_id: "c" }], has_more: false };
  }, { mailbox: "orders@example.com", sender: "control@iwayex.com" });
  expect(result.messages.map(item => item.message_id)).toEqual(["a", "b", "c"]);

  expect(() => fetchAllTriagePages(() => ({
    messages: [{ subject: "no-id" }], has_more: false,
  }), { mailbox: "orders@example.com", sender: "control@iwayex.com" })).toThrow(/message_id/);
});

test("服务端报告有下一页却返回空页时失败，避免无限空翻页", () => {
  expect(() => fetchAllTriagePages(() => ({
    messages: [], has_more: true, page_token: "next",
  }), { mailbox: "orders@example.com", sender: "control@iwayex.com" })).toThrow(/空页/);
});
