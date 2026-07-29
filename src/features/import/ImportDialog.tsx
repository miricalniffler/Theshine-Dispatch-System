"use client";

import { useEffect, useState } from "react";
import "./import-dialog.css";

type SourceType = "iway_feishu" | "esforty" | "manual";
type Connector = { id: "feishu-mail" | "esforty"; label: string; configured: boolean; message: string };
type SyncRun = { status: string; startedAt: string; completedAt?: string | null; createdCount: number; updatedCount: number; cancelledCount: number; skippedCount: number };

export function ImportDialog({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>("iway_feishu");
  const [confirmedSource, setConfirmedSource] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<any>(null);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [note, setNote] = useState("");
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [latestRun, setLatestRun] = useState<SyncRun | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/orders/import/connectors").then((r) => r.json()).then((data) => setConnectors(data.data?.connectors || []));
    const loadSyncStatus = () => fetch("/api/import-sync/feishu-mail").then((r) => r.json()).then((data) => setLatestRun(data.data?.latestRun || null));
    loadSyncStatus();
    const timer = window.setInterval(loadSyncStatus, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function parse() {
    setNote("");
    const response = await fetch("/api/orders/import/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sourceType, confirmedSource }) });
    const payload = await response.json();
    if (!response.ok) { setNote(payload.error?.message || "识别失败"); return; }
    setResult(payload.data); setFields(payload.data.fields); setStep(2);
  }

  async function save() {
    const response = await fetch("/api/orders/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, source: result.source, rawText: text }) });
    const payload = await response.json();
    if (!response.ok) { setNote(payload.error?.message || "保存失败"); return; }
    setNote(payload.data.message); setStep(3);
  }

  async function pull(connectorId: Connector["id"]) {
    const response = await fetch("/api/orders/import/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectorId }) });
    const payload = await response.json();
    if (!response.ok) { setNote(payload.error?.message || "读取失败"); return; }
    setText(payload.data.items[0]?.text || "");
    setSourceType(connectorId === "feishu-mail" ? "iway_feishu" : "esforty");
  }

  async function runManualSync() {
    setSyncing(true); setNote("");
    const response = await fetch("/api/import-sync/feishu-mail", { method: "POST" });
    const payload = await response.json();
    setSyncing(false);
    if (!response.ok) { setNote(payload.error?.message || "同步失败"); return; }
    const now = new Date().toISOString();
    setLatestRun({ status: "REQUESTED", startedAt: now, createdCount: 0, updatedCount: 0, cancelledCount: 0, skippedCount: 0 });
    setNote(payload.data.alreadyQueued ? "同步请求已在等待本机处理，请稍后刷新查看结果。" : "同步请求已发送；本机在线时会在约 1 分钟内读取飞书订单。");
  }

  const latestRunText = latestRun
    ? `${latestRun.status === "SUCCEEDED" ? "上次同步成功" : latestRun.status === "FAILED" ? "上次同步失败" : latestRun.status === "REQUESTED" ? "已请求，等待本机处理" : "同步处理中"} · ${new Date(latestRun.completedAt || latestRun.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "尚未同步过飞书订单";

  const body = <section className="import-dialog" role={onClose ? "dialog" : undefined} aria-modal={onClose ? "true" : undefined} aria-labelledby="import-title">
    <header><div><p>导入新订单</p><h2 id="import-title">先同步，再核对字段</h2></div>{onClose && <button aria-label="关闭导入" onClick={onClose}>×</button>}</header>
    <ol className="import-steps"><li className={step >= 1 ? "active" : ""}>1. 获取订单</li><li className={step >= 2 ? "active" : ""}>2. 核对结果</li><li className={step >= 3 ? "active" : ""}>3. 查重保存</li></ol>
    {note && <p className="import-note" role="status">{note}</p>}
    {step === 1 && <div className="import-source">
      <section className="import-sync-panel" aria-label="飞书订单同步"><div><strong>飞书订单同步</strong><p>{latestRunText}</p></div><button className="import-sync-button" onClick={runManualSync} disabled={syncing}>{syncing ? "正在请求…" : "立即同步"}</button></section>
      <label>订单来源<select value={sourceType} onChange={(event) => { setSourceType(event.target.value as SourceType); setConfirmedSource(false); }}><option value="iway_feishu">i’way 飞书邮件（New ride）</option><option value="esforty">esforty 订单</option><option value="manual">手工新增</option></select></label>
      <div className="import-connectors">{connectors.filter((connector) => connector.id !== "feishu-mail").map((connector) => <button key={connector.id} disabled={!connector.configured} title={connector.message} onClick={() => pull(connector.id)}>{connector.configured ? `从${connector.label}读取` : `${connector.label}尚未接入`}</button>)}</div>
      <label>订单原文<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴整封 i’way New ride 邮件或 esforty 订单文字" /></label>
      {sourceType === "manual" && <label className="source-confirm"><input type="checkbox" checked={confirmedSource} onChange={(event) => setConfirmedSource(event.target.checked)} />我已人工确认这是一张需要进入本平台的新订单</label>}
      <p>系统会拦截车队司机回复和来源不匹配的文字，不会自动保存。</p>
      <footer><button className="v3-primary" onClick={parse}>识别并进入核对</button></footer>
    </div>}
    {step === 2 && <div className="import-review"><div><h3>识别字段</h3>{Object.entries(fields).map(([key, value]) => <label key={key}>{key}<input value={String(value ?? "")} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><div><h3>来源原文</h3><pre>{text}</pre><p>来源：{result.source.type} · 格式：{result.source.format} · 已核实</p></div><footer><button className="v3-secondary" onClick={() => setStep(1)}>返回修改</button><button className="v3-primary" onClick={save} disabled={result.duplicates.exact.length > 0}>{result.duplicates.exact.length ? "订单号已存在" : "确认并保存订单"}</button></footer></div>}
    {step === 3 && <div className="import-success"><b>订单已安全保存</b><p>来源原文和核验结果已记录。你可以回到订单工作台继续选择车队。</p><button className="v3-primary" onClick={() => onClose ? onClose() : location.assign("/orders")}>返回订单工作台</button></div>}
  </section>;

  return onClose ? <div className="import-backdrop" onMouseDown={onClose}><div onMouseDown={(event) => event.stopPropagation()}>{body}</div></div> : <main className="import-page">{body}</main>;
}
