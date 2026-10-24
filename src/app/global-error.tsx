"use client";

import { useEffect } from "react";

/** Avoid a blank screen if a browser-specific client rendering error occurs. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the detail in the browser console for support without displaying
    // private order data in the page itself.
    console.error("页面初始化失败", error);
  }, [error]);

  return <html lang="zh-CN"><body><main className="browser-error-page"><section><p>页面加载遇到问题</p><h1>暂时无法打开工作台</h1><span>请重新加载页面。若问题仍然存在，可先回到登录页再进入订单工作台；订单数据不会因此丢失。</span><div><button type="button" onClick={reset}>重新加载</button><a href="/login">回到登录页</a></div></section></main></body></html>;
}
