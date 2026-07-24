"use client";

import { useEffect, useState } from "react";

type Preview = { version: string; dispatch: string; iway: string };
type Version = { id: string; version: string; isCurrent: boolean; publishedBy: string | null; publishedAt: string };

export default function RulesPage() {
  const [source, setSource] = useState(""); const [preview, setPreview] = useState<Preview | null>(null); const [notice, setNotice] = useState("正在读取当前规则…"); const [versions, setVersions] = useState<Version[]>([]); const [publishing, setPublishing] = useState(false);
  async function refreshVersions() { const response = await fetch("/api/rules/history"); const data = await response.json(); if (response.ok) setVersions(data.data.versions); }
  useEffect(() => { fetch("/api/rules/current").then((r) => r.json()).then((data) => { if (data.data) { setSource(data.data.source); setNotice(`当前发布版本：${data.data.version}`); } else setNotice(data.error?.message || "读取当前规则失败。"); }); void refreshVersions(); }, []);
  async function updatePreview() { const response = await fetch("/api/rules/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) }); const data = await response.json(); if (!response.ok) { setPreview(null); setNotice(`不能预览：${data.error?.message || "规则格式错误"}`); return; } setPreview(data.data); setNotice(`预览成功：规则版本 ${data.data.version}。本页只预览，不会直接发布或覆盖历史规则。`); }
  async function publish() { setPublishing(true); const response = await fetch("/api/rules/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) }); const data = await response.json(); setPublishing(false); if (!response.ok) { setNotice(`不能发布：${data.error?.message || "发布失败"}`); return; } setNotice(`已发布规则版本 ${data.data.version}。后续派单和回传将读取此 YAML。`); setPreview(null); await refreshVersions(); }
  return <main className="rules-page"><nav><a href="/orders">订单工作台</a><a href="/fleets">车队管理</a><a className="active" href="/rules">规则中心</a></nav><header><p>05 · 规则中心</p><h1>先验证，再发布</h1><span>{notice}</span></header><section className="rules-layout"><div><label htmlFor="rule-source">business-rules.yaml</label><textarea id="rule-source" value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false}/><div><button onClick={updatePreview}>校验并刷新预览</button><button onClick={publish} disabled={publishing}>{publishing ? "正在发布…" : "发布新版本"}</button></div><p>发布前请先更新 YAML 里的 <code>rules_version</code>。已发布版本会永久保留，不会被覆盖。</p><h2>版本历史</h2><ul>{versions.map((item) => <li key={item.id}><strong>{item.version}</strong>{item.isCurrent ? "（当前）" : ""} · {new Date(item.publishedAt).toLocaleString()} · {item.publishedBy || "未记录"}</li>)}</ul></div><div className="rules-preview"><h2>派单预览</h2><pre>{preview?.dispatch || "点击“校验并刷新预览”后显示示例派单。"}</pre><h2>i’way 回传预览</h2><pre>{preview?.iway || "回传预览会使用同一份规则。"}</pre></div></section></main>;
}
