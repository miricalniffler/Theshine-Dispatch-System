import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isolatedPreviewValue } from "@/lib/isolated-preview";

function passwordsMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: "" }));
  const expectedPassword = isolatedPreviewValue("TEAM_ACCESS_PASSWORD");
  const accessToken = isolatedPreviewValue("TEAM_ACCESS_TOKEN");
  if (!expectedPassword || !accessToken) {
    return NextResponse.json({ error: "网站访问设置尚未完成，请联系管理员。" }, { status: 503 });
  }
  if (typeof password !== "string" || !passwordsMatch(password, expectedPassword)) {
    return NextResponse.json({ error: "访问密码不正确。" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("iway-team-access", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
