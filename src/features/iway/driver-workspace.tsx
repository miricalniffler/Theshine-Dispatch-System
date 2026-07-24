"use client";

import { useEffect, useMemo, useState } from "react";
import type { Order } from "@/features/orders/types";
import type { DriverDetails } from "./service";
import "./iway.css";

type WorkItem = { order: Order; driver: DriverDetails | null };
type Notice = { tone: "success" | "error"; message: string } | null;

const statusText: Record<Order["status"], string> = { PENDING_REVIEW: "待核对", READY_TO_DISPATCH: "待派单", DISPATCHED: "等待司机资料", DRIVER_CONFIRMED: "可回传", RETURNED: "已回传", COMPLETED: "已完成" };

function blankDriver(): DriverDetails { return { orderId: "", rawReply: "", confirmedDriverName: null, rawDriverPhone: null, normalizedDriverPhone: null, confirmedVehicleModel: null, licensePlate: null, confirmedAt: null }; }

function DriverCard({ item, onSaved }: { item: WorkItem; onSaved: () => void }) {
  const [form, setForm] = useState<DriverDetails>({ ...blankDriver(), ...(item.driver ?? {}), orderId: item.order.id });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setForm({ ...blankDriver(), ...(item.driver ?? {}), orderId: item.order.id }), [item]);
  const set = (key: keyof DriverDetails, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    setSaving(true); setNotice(null);
    const response = await fetch(`/api/orders/${item.order.id}/driver-details`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) { setNotice({ tone: "error", message: payload.error?.message ?? "保存失败" }); return; }
    setForm(payload.data.driver);
    setNotice(payload.data.valid ? { tone: "success", message: "资料完整，订单已进入待回传。" } : { tone: "error", message: `已保存草稿；还缺少：${payload.data.missingFields.join("、")}` });
    onSaved();
  }
  return <article className="driver-card">
    <header><div><span className="order-mark">{item.order.city} · {item.order.serviceDate} {item.order.pickupTime}</span><h2>{item.order.orderNo}</h2><p>{item.order.passengerName} · {item.order.route}</p></div><span className={`work-status ${item.order.status.toLowerCase()}`}>{statusText[item.order.status]}</span></header>
    <label className="wide-field">车队原始回复（保留原文）<textarea value={form.rawReply ?? ""} placeholder="粘贴车队回复；系统不会替你发送任何消息" onChange={(event) => set("rawReply", event.target.value)} /></label>
    <div className="driver-form">
      <label>司机姓名<input value={form.confirmedDriverName ?? ""} onChange={(event) => set("confirmedDriverName", event.target.value)} placeholder="例如 Somchai" /></label>
      <label>司机电话<input value={form.rawDriverPhone ?? ""} onChange={(event) => set("rawDriverPhone", event.target.value)} placeholder="例如 081-234-5678" /></label>
      <label>确认车型<input value={form.confirmedVehicleModel ?? ""} onChange={(event) => set("confirmedVehicleModel", event.target.value)} placeholder="例如 Toyota Commut" /></label>
      <label>车牌号<input value={form.licensePlate ?? ""} onChange={(event) => set("licensePlate", event.target.value)} placeholder="例如 1กข 2345" /></label>
    </div>
    {form.normalizedDriverPhone && <p className="normalized">规范后的泰国电话：<strong>{form.normalizedDriverPhone}</strong></p>}
    {notice && <p className={`inline-notice ${notice.tone}`}>{notice.message}</p>}
    <footer><small>电话和车型会按当前 YAML 规则转换；原号码不会被覆盖。</small><button type="button" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存并校验"}</button></footer>
  </article>;
}

export function DriverWorkspace() {
  const [items, setItems] = useState<WorkItem[]>([]); const [loading, setLoading] = useState(true);
  const refresh = () => fetch("/api/driver-details").then((response) => response.json()).then((payload) => setItems(payload.data)).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);
  return <main className="workflow-page"><nav className="workflow-nav"><a href="/orders">订单工作台</a><a className="active" href="/driver-details">司机资料</a><a href="/iway-return">i’way 回传</a></nav><header className="workflow-header"><p className="workflow-kicker">03 · 司机资料</p><h1>把车队回复变成可回传的信息</h1><p>确认四项资料后，系统才允许生成 i’way 回传文本。电话和车型均从规则文件读取并转换。</p></header>{loading ? <p className="loading">正在加载司机资料…</p> : <section className="driver-list">{items.length ? items.map((item) => <DriverCard key={item.order.id} item={item} onSaved={refresh} />) : <p className="empty-work">没有需要确认司机资料的订单。</p>}</section>}</main>;
}

export function IwayReturnWorkspace() {
  const [items, setItems] = useState<WorkItem[]>([]); const [selected, setSelected] = useState<string[]>([]); const [preview, setPreview] = useState<{ valid: boolean; errors: string[]; text?: string; orderCount: number; ruleVersion: string } | null>(null); const [batchId, setBatchId] = useState<string | null>(null); const [notice, setNotice] = useState<Notice>(null);
  const refresh = () => fetch("/api/driver-details").then((r) => r.json()).then((payload) => setItems(payload.data));
  useEffect(() => { refresh(); }, []);
  const selectable = useMemo(() => items.filter((item) => item.order.status === "DRIVER_CONFIRMED" || item.order.status === "RETURNED"), [items]);
  const toggle = (id: string) => { setBatchId(null); setPreview(null); setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); };
  async function createPreview() { setNotice(null); setBatchId(null); const response = await fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: selected }) }); const payload = await response.json(); setPreview(payload.data); }
  async function copy() { const response = await fetch("/api/iway-return-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: selected }) }); const payload = await response.json(); if (!payload.data?.valid) { setPreview(payload.data); return; } await navigator.clipboard?.writeText(payload.data.text); setBatchId(payload.data.batchId); setNotice({ tone: "success", message: "文本已复制。请到 i’way 人工发送后，再回来确认。" }); }
  async function confirm() { if (!batchId) return; const response = await fetch("/api/iway-return-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) }); const payload = await response.json(); if (!response.ok) { setNotice({ tone: "error", message: payload.error?.message ?? "确认失败" }); return; } setNotice({ tone: "success", message: "已记录人工回传，相关订单已完成。" }); setSelected([]); setPreview(null); setBatchId(null); refresh(); }
  return <main className="workflow-page"><nav className="workflow-nav"><a href="/orders">订单工作台</a><a href="/driver-details">司机资料</a><a className="active" href="/iway-return">i’way 回传</a></nav><header className="workflow-header"><p className="workflow-kicker">04 · I’WAY 回传</p><h1>按服务日合并，人工完成最后发送</h1><p>可把同一服务日的曼谷和苏梅订单合并为一条回传。复制不会改变订单状态。</p></header><section className="return-grid"><div className="return-selection"><h2>选择待回传订单</h2><p>只能选择同一个服务日；系统会在生成前再做一次校验。</p>{selectable.length ? selectable.map(({ order, driver }) => <label className="return-order" key={order.id}><input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} /><span><strong>{order.orderNo}</strong><small>{order.city} · {order.serviceDate} {order.pickupTime} · {driver?.confirmedDriverName ?? "未确认司机"}</small></span></label>) : <p className="empty-work">没有可回传的订单。请先完成司机资料确认。</p>}<button type="button" className="secondary-action" onClick={createPreview} disabled={!selected.length}>生成回传预览</button></div><div className="return-preview"><div className="preview-heading"><div><span>回传文本预览</span><strong>{preview?.orderCount ? `${preview.orderCount} 个订单` : "尚未生成"}</strong></div>{preview?.ruleVersion && <small>规则 {preview.ruleVersion}</small>}</div>{preview?.errors.length ? <div className="validation-errors"><strong>暂不能生成</strong>{preview.errors.map((error) => <p key={error}>{error}</p>)}</div> : preview?.text ? <pre>{preview.text}</pre> : <p className="preview-empty">选择订单后生成预览。文本的开头、每单内容和结尾均来自 YAML 规则文件。</p>}{notice && <p className={`inline-notice ${notice.tone}`}>{notice.message}</p>}<div className="preview-actions"><button type="button" onClick={copy} disabled={!preview?.valid}>复制回传内容</button><button type="button" className="confirm-action" onClick={confirm} disabled={!batchId}>我已人工发送，确认回传</button></div></div></section></main>;
}
