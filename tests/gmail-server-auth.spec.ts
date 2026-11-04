import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { POST } from "../src/app/api/import-sync/gmail-iway/route";
import { POST as manualPost } from "../src/app/api/import-sync/gmail-iway/manual/route";

test("Gmail server POST reaches dedicated bearer authentication without a team cookie", async () => {
  const request = new NextRequest("https://example.com/api/import-sync/gmail-iway", { method: "POST" });
  expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
  const response = await POST(request);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORISED" } });
});

test("status, sibling routes and other methods still require team login", async () => {
  const oldToken = process.env.TEAM_ACCESS_TOKEN;
  process.env.TEAM_ACCESS_TOKEN = "test-team-only";
  try {
    for (const [path, method] of [["/api/import-sync/gmail-iway", "GET"], ["/api/import-sync/gmail-iway/other", "POST"], ["/api/orders", "POST"], ["/api/import-sync/gmail-iway", "DELETE"]]) {
      const response = await proxy(new NextRequest(`https://example.com${path}`, { method }));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    }
  } finally {
    if (oldToken === undefined) delete process.env.TEAM_ACCESS_TOKEN;
    else process.env.TEAM_ACCESS_TOKEN = oldToken;
  }
});

test("手动 Gmail 扫描接口即使代理配置意外变化也会自行拒绝未登录请求", async () => {
  const oldToken = process.env.TEAM_ACCESS_TOKEN;
  process.env.TEAM_ACCESS_TOKEN = "test-team-only";
  try {
    const response = await manualPost(new NextRequest("https://example.com/api/import-sync/gmail-iway/manual", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORISED" } });
  } finally {
    if (oldToken === undefined) delete process.env.TEAM_ACCESS_TOKEN;
    else process.env.TEAM_ACCESS_TOKEN = oldToken;
  }
});
