"use client";

import { useEffect, useState } from "react";
import { startupDiagnosticsStorageKey, type StartupDiagnostic } from "@/components/StartupDiagnostics";

type BrowserState = { serviceWorker: string; storage: string };

export function DiagnosticClient() {
  const [entries, setEntries] = useState<StartupDiagnostic[]>([]);
  const [browser, setBrowser] = useState<BrowserState>({ serviceWorker: "检查中", storage: "检查中" });

  useEffect(() => {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(startupDiagnosticsStorageKey) ?? "[]") as StartupDiagnostic[];
      setEntries(value);
      setBrowser({
        serviceWorker: "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "已控制当前页面" : "尚未控制当前页面") : "浏览器不支持",
        storage: "可读取",
      });
    } catch {
      setBrowser({ serviceWorker: "无法确认", storage: "受限或不可用" });
    }
  }, []);

  return <section className="diagnostic-card">
    <h2>本机启动记录</h2>
    <p>只保存在这台设备当前浏览器会话中；不会上传订单、密码、令牌、完整报错或客户资料。</p>
    <dl><div><dt>Service Worker</dt><dd>{browser.serviceWorker}</dd></div><div><dt>会话存储</dt><dd>{browser.storage}</dd></div></dl>
    {entries.length ? <ul>{entries.map((entry, index) => <li key={`${entry.at}-${index}`}><time>{entry.at}</time> · {entry.kind} · {entry.detail}</li>)}</ul> : <p>尚未捕获启动事件。</p>}
  </section>;
}
