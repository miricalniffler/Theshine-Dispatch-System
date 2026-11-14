import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { GET, POST } from "../src/app/api/mail-operations/gmail/manual/route";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("manual operations sync is team-authenticated and sends only a signed operations action server-side", async () => {
  const oldTeam = process.env.TEAM_ACCESS_TOKEN;
  const oldUrl = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const oldSecret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  const oldFetch = global.fetch;
  process.env.TEAM_ACCESS_TOKEN = "test-team-only";
  process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
  process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "server-only-secret";
  let signedAction = "";
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    signedAction = JSON.parse(String(init?.body || "{}")).action;
    return new Response(JSON.stringify({ status: "SUCCEEDED", summary: { created: 3, skipped: 1 }, latestSuccessAt: "2026-11-15T00:00:00.000Z" }), { status: 200 });
  }) as typeof fetch;
  try {
    const denied = await POST(new NextRequest("https://example.com/api/mail-operations/gmail/manual", { method: "POST" }));
    expect(denied.status).toBe(401);
    const request = new NextRequest("https://example.com/api/mail-operations/gmail/manual", { method: "POST", headers: { cookie: "iway-team-access=test-team-only" } });
    const pass = await proxy(request);
    expect(pass.headers.get("x-middleware-next")).toBe("1");
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { completed: true, created: 3, skipped: 1, latestSuccessfulSyncAt: "2026-11-15T00:00:00.000Z" } });
    expect(signedAction).toBe("operations");
  } finally {
    restore("TEAM_ACCESS_TOKEN", oldTeam);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", oldUrl);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", oldSecret);
    global.fetch = oldFetch;
  }
});

test("manual operations status returns last success time without reading Gmail", async () => {
  const oldTeam = process.env.TEAM_ACCESS_TOKEN;
  const oldUrl = process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL;
  const oldSecret = process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET;
  const oldFetch = global.fetch;
  process.env.TEAM_ACCESS_TOKEN = "test-team-only";
  process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL = "https://script.google.com/macros/s/test/exec";
  process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET = "server-only-secret";
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("action")).toBe("status");
    return new Response(JSON.stringify({ status: "READY", latestOperationsSuccessAt: "2026-11-14T22:30:00.000Z" }), { status: 200 });
  }) as typeof fetch;
  try {
    const request = new NextRequest("https://example.com/api/mail-operations/gmail/manual", { headers: { cookie: "iway-team-access=test-team-only" } });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { available: true, latestSuccessfulSyncAt: "2026-11-14T22:30:00.000Z" } });
  } finally {
    restore("TEAM_ACCESS_TOKEN", oldTeam);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_URL", oldUrl);
    restore("IWAY_GMAIL_MANUAL_TRIGGER_SECRET", oldSecret);
    global.fetch = oldFetch;
  }
});

test("proxy passes the manual operations POST to its own authentication guard", async () => {
  const response = await proxy(new NextRequest("https://example.com/api/mail-operations/gmail/manual", { method: "POST" }));
  expect(response.headers.get("x-middleware-next")).toBe("1");
});
