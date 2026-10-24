import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const headers = {
  "cache-control": "no-store, max-age=0",
  "content-type": "text/html; charset=utf-8",
  "x-iway-mobile-diagnostic": "plain-html-v1",
};

function responseTime() {
  return new Date().toISOString();
}

/**
 * This handler deliberately returns hand-written HTML rather than a Next page.
 * It remains independent of React, layouts, the service worker, login,
 * database access, and external assets.
 */
export function GET(request: NextRequest) {
  const now = responseTime();
  if (request.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json(
      { ok: true, endpoint: "plain-html-mobile-diagnostic", time: now },
      { headers: { "cache-control": headers["cache-control"], "x-iway-mobile-diagnostic": headers["x-iway-mobile-diagnostic"] } },
    );
  }

  return new NextResponse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>手机连接诊断</title>
<style>body{margin:0;background:#f4f7fb;color:#14233c;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{max-width:640px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dbe4f0;border-radius:16px;box-shadow:0 8px 24px #14233c12}button{padding:10px 14px;border:0;border-radius:8px;background:#2356c4;color:#fff;font:inherit}code{word-break:break-all}#result{min-height:24px;color:#45617d}</style>
</head><body><main class="card"><h1>手机连接诊断</h1><p>此页不使用登录、订单、数据库、React、导航或离线缓存。</p><p>服务器时间：<code id="time">${now}</code></p><button id="check" type="button">检查同源响应</button><p id="result" role="status">尚未检查</p></main><script>document.getElementById("check").addEventListener("click",async function(){var output=document.getElementById("result");output.textContent="正在检查…";try{var response=await fetch("/diagnostics/mobile?format=json",{cache:"no-store"});var data=await response.json();output.textContent=response.ok&&data.ok?"同源响应正常："+data.time:"同源响应异常：HTTP "+response.status}catch(error){output.textContent="同源请求失败（未显示技术细节）"}})</script></body></html>`, { headers });
}
