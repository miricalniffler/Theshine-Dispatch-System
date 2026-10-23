"use client";

import { useEffect, useState } from "react";
import { RegionNotificationSettings } from "@/features/airport-guides/RegionNotificationSettings";
import { VehicleCapacityRules } from "@/features/customer-notifications/VehicleCapacityRules";

type Preview = { version: string; dispatch: string; iway: string };
type Version = { id: string; version: string; isCurrent: boolean; publishedBy: string | null; publishedAt: string };
type FeishuSyncStatus = {
  connector?: { configured: boolean; message: string };
  scheduleEnabled?: boolean;
  latestRun?: { status: "RUNNING" | "SUCCEEDED" | "FAILED"; completedAt?: string | null; startedAt: string; createdCount: number; updatedCount: number; cancelledCount: number; skippedCount: number; errorMessage?: string | null } | null;
};

type GmailSyncStatus = {
  configured: boolean;
  latestRun?: { status: "RUNNING" | "SUCCEEDED" | "FAILED"; completedAt?: string | null; startedAt: string; createdCount: number; skippedCount: number; errorMessage?: string | null } | null;
};

function FeishuSyncState() {
  const [status, setStatus] = useState<FeishuSyncStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/import-sync/feishu-mail", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || "无法读取飞书同步状态");
      setStatus(payload?.data || null);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取飞书同步状态"));
  }, []);
  const run = status?.latestRun;
  const connector = status?.connector;
  const label = !status ? "正在读取状态…" : !connector?.configured ? "服务器同步尚未配置" : run?.status === "FAILED" ? "上次同步失败" : run?.status === "RUNNING" ? "同步进行中" : run?.status === "SUCCEEDED" ? "上次同步成功" : "尚未同步";
  const detail = error || (!status ? "" : !connector?.configured ? (connector?.message || "请配置飞书邮件导入桥接。") : run?.status === "FAILED" ? (run.errorMessage || "请在订单工作台重新尝试。") : run?.status === "SUCCEEDED" ? `新增 ${run.createdCount} · 更新 ${run.updatedCount} · 取消 ${run.cancelledCount} · 跳过 ${run.skippedCount}` : "前往订单工作台可手动同步并查看完整结果。");
  return <section className="sync-status-card" aria-label="飞书订单同步状态"><div><p>飞书订单同步</p><h2>{label}</h2><span>{detail}</span></div><a href="/orders">前往订单工作台</a></section>;
}

function GmailSyncState() {
  const [status, setStatus] = useState<GmailSyncStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/import-sync/gmail-iway", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || "无法读取 Gmail 同步状态");
      setStatus(payload?.data || null);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取 Gmail 同步状态"));
  }, []);
  const run = status?.latestRun;
  const label = !status ? "正在读取状态…" : !status.configured ? "Gmail 同步待启用" : run?.status === "FAILED" ? "上次同步失败" : run?.status === "RUNNING" ? "同步进行中" : run?.status === "SUCCEEDED" ? "上次同步成功" : "尚未同步";
  const detail = error || (!status ? "" : !status.configured ? "等待 Gmail 授权及安全启用；现有飞书 / Mac 同步不受影响。" : run?.status === "FAILED" ? (run.errorMessage || "请检查 Gmail 同步执行记录。") : run?.status === "SUCCEEDED" ? `新增 ${run.createdCount} · 已存在或未导入 ${run.skippedCount}` : "Google Apps Script 会按计划检查可信 iWay 新订单。取消和修改邮件不会自动处理。");
  return <section className="sync-status-card" aria-label="Gmail iWay 新订单同步状态"><div><p>Gmail iWay 新订单同步</p><h2>{label}</h2><span>{detail}</span></div><span>仅导入新订单</span></section>;
}

export default function RulesPage() {
  const [source, setSource] = useState(""); const [preview, setPreview] = useState<Preview | null>(null); const [notice, setNotice] = useState("正在读取当前规则…"); const [versions, setVersions] = useState<Version[]>([]); const [publishing, setPublishing] = useState(false);
  async function refreshVersions() { const response = await fetch("/api/rules/history"); const data = await response.json(); if (response.ok) setVersions(data.data.versions); }
  useEffect(() => { fetch("/api/rules/current").then((r) => r.json()).then((data) => { if (data.data) { setSource(data.data.source); setNotice(`当前发布版本：${data.data.version}`); } else setNotice(data.error?.message || "读取当前规则失败。"); }); void refreshVersions(); }, []);
  async function updatePreview() { const response = await fetch("/api/rules/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) }); const data = await response.json(); if (!response.ok) { setPreview(null); setNotice(`不能预览：${data.error?.message || "规则格式错误"}`); return; } setPreview(data.data); setNotice(`预览成功：规则版本 ${data.data.version}。本页只预览，不会直接发布或覆盖历史规则。`); }
  async function publish() { setPublishing(true); const response = await fetch("/api/rules/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) }); const data = await response.json(); setPublishing(false); if (!response.ok) { setNotice(`不能发布：${data.error?.message || "发布失败"}`); return; } setNotice(`已发布规则版本 ${data.data.version}。后续派单和回传将读取此 YAML。`); setPreview(null); await refreshVersions(); }
  async function rollback(version: string) { if (!window.confirm(`确认以 ${version} 为基础创建一个新的当前规则版本？旧版本不会被覆盖。`)) return; const response = await fetch(`/api/rules/${encodeURIComponent(version)}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const data = await response.json(); if (!response.ok) { setNotice(`不能回退：${data.error?.message || "回退失败"}`); return; } setSource(data.data.yamlContent); setPreview(null); setNotice(`已从 ${version} 创建新的当前版本 ${data.data.version}。`); await refreshVersions(); }
  return <main className="rules-page"><nav><a href="/orders">订单工作台</a><a href="/airport-guides">机场指引库</a><a href="/fleets">车队管理</a><a className="active" href="/rules">设置 / 规则</a></nav><header><p>设置 / 规则</p><h1>先验证，再发布</h1><span>{notice}</span></header><FeishuSyncState /><GmailSyncState /><RegionNotificationSettings /><VehicleCapacityRules /><section className="rules-layout"><div><label htmlFor="rule-source">business-rules.yaml</label><textarea id="rule-source" value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false}/><div><button onClick={updatePreview}>校验并刷新预览</button><button onClick={publish} disabled={publishing}>{publishing ? "正在发布…" : "发布新版本"}</button></div><p>发布前请先更新 YAML 里的 <code>rules_version</code>。已发布版本会永久保留，不会被覆盖。</p><h2>版本历史</h2><ul>{versions.map((item) => <li key={item.id}><strong>{item.version}</strong>{item.isCurrent ? "（当前）" : ""} · {new Date(item.publishedAt).toLocaleString()} · {item.publishedBy || "未记录"}{!item.isCurrent && <button type="button" onClick={() => rollback(item.version)}>以此版本回退</button>}</li>)}</ul></div><div className="rules-preview"><h2>派单预览</h2><pre>{preview?.dispatch || "点击“校验并刷新预览”后显示示例派单。"}</pre><h2>i’way 回传预览</h2><pre>{preview?.iway || "回传预览会使用同一份规则。"}</pre></div></section></main>;
}
