"use client";

import { FormEvent, useState } from "react";
import "./login.css";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    const response = await fetch("/api/access/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json() as { error?: string };
    setSending(false);
    if (!response.ok) {
      setNotice(result.error || "登录失败，请稍后重试。");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next") || "/orders";
    window.location.assign(next);
  }
  return <main className="login-page"><section className="login-card"><p className="eyebrow">I’WAY · OPERATIONS</p><h1>接送机发单平台</h1><p>请输入团队访问密码即可进入，无需接收邮件。</p><form onSubmit={signIn}><label htmlFor="password">团队访问密码</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入访问密码" required /><button type="submit" disabled={sending}>{sending ? "正在验证…" : "进入系统"}</button></form>{notice && <p className="login-notice" role="status">{notice}</p>}</section></main>;
}
