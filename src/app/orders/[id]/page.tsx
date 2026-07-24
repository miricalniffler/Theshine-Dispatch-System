"use client";

import { FormEvent, useEffect, useState } from "react";
import "@/features/orders/order-detail.css";

type Detail = Record<string, any>;
function localDateTime(value?: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (name: string) => parts.find((part) => part.type === name)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function formValues(order: Detail) {
  return { platformOrderNumber: order.platformOrderNumber ?? "", city: order.city ?? "曼谷", fleetId: order.fleetId ?? "", pickupDateTime: localDateTime(order.pickupDateTime), pickupAddress: order.pickupAddress ?? "", dropoffAddress: order.dropoffAddress ?? "", passengerName: order.passengerName ?? "", passengerPhone: order.passengerPhone ?? "", flightNumber: order.flightNumber ?? "", platformVehicleType: order.platformVehicleType ?? "", seatCount: order.seatCount ?? "", adults: order.adults ?? 0, children: order.children ?? 0, luggage: order.luggage ?? 0, childSeatLine: order.childSeatLine ?? "", meetGreetLine: order.meetGreetLine ?? "", otherNotes: order.otherNotes ?? "" };
}

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState(""); const [order, setOrder] = useState<Detail | null>(null); const [form, setForm] = useState<Record<string, any>>({});
  const [activity, setActivity] = useState<any[]>([]); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const refresh = (orderId: string) => Promise.all([fetch(`/api/orders/${orderId}`).then((r) => r.json()), fetch(`/api/orders/${orderId}/activity`).then((r) => r.json())]).then(([detail, timeline]) => { setOrder(detail.data ?? null); if (detail.data) setForm(formValues(detail.data)); setActivity(timeline.data ?? []); });
  useEffect(() => { params.then(({ id: orderId }) => { setId(orderId); void refresh(orderId); }); }, [params]);
  const change = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage(""); setSaving(true);
    const body = { ...form, fleetId: form.fleetId || null, seatCount: form.seatCount === "" ? null : Number(form.seatCount), adults: Number(form.adults), children: Number(form.children), luggage: Number(form.luggage) };
    const response = await fetch(`/api/orders/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error?.message ?? "保存失败，请稍后重试。"); return; }
    setMessage(data.updatedFields?.length ? "已保存订单信息，并记录本次修改。" : "没有需要保存的修改。"); await refresh(id);
  };
  return <main className="rules-page"><nav><a href="/orders">订单工作台</a><a className="active" href="#">订单详情</a></nav><header><p>订单详情</p><h1>{order?.platformOrderNumber || "正在读取订单…"}</h1>{order && <span className="order-status-badge">当前状态：{order.status}</span>}</header>{order && <div className="order-detail-grid"><section className="order-detail-card"><h2>编辑订单</h2>{error && <p className="order-error">{error}</p>}<form className="order-edit-form" onSubmit={save}>
    <label>平台订单号<input value={form.platformOrderNumber} onChange={(e) => change("platformOrderNumber", e.target.value)} required /></label><label>服务城市<select value={form.city} onChange={(e) => change("city", e.target.value)}><option value="曼谷">曼谷</option><option value="苏梅">苏梅</option></select></label>
    <label>接客日期与时间<input type="datetime-local" value={form.pickupDateTime} onChange={(e) => change("pickupDateTime", e.target.value)} required /><span className="hint">按泰国当地时间填写</span></label><label>派送车队<input value={form.city === "苏梅" ? "苏梅车队（自动分配）" : "曼谷车队（自动分配）"} disabled /></label>
    <label>乘客姓名<input value={form.passengerName} onChange={(e) => change("passengerName", e.target.value)} required /></label><label>乘客电话<input value={form.passengerPhone} onChange={(e) => change("passengerPhone", e.target.value)} required /></label><label>航班号<input value={form.flightNumber} onChange={(e) => change("flightNumber", e.target.value)} /></label><label>平台车型<input value={form.platformVehicleType} onChange={(e) => change("platformVehicleType", e.target.value)} required /></label>
    <label>座位数<input type="number" min="0" value={form.seatCount} onChange={(e) => change("seatCount", e.target.value)} /></label><label>成人 / 儿童 / 行李<div style={{ display: "flex", gap: 6 }}><input aria-label="成人" type="number" min="0" value={form.adults} onChange={(e) => change("adults", e.target.value)} /><input aria-label="儿童" type="number" min="0" value={form.children} onChange={(e) => change("children", e.target.value)} /><input aria-label="行李" type="number" min="0" value={form.luggage} onChange={(e) => change("luggage", e.target.value)} /></div></label>
    <label className="full-width">上车地点<textarea value={form.pickupAddress} onChange={(e) => change("pickupAddress", e.target.value)} required /></label><label className="full-width">下车地点<textarea value={form.dropoffAddress} onChange={(e) => change("dropoffAddress", e.target.value)} required /></label><label>儿童座椅说明<textarea value={form.childSeatLine} onChange={(e) => change("childSeatLine", e.target.value)} /></label><label>举牌 / 接机说明<textarea value={form.meetGreetLine} onChange={(e) => change("meetGreetLine", e.target.value)} /></label><label className="full-width">其他备注<textarea value={form.otherNotes} onChange={(e) => change("otherNotes", e.target.value)} /></label>
    <div className="order-edit-actions full-width">{message && <span className="order-save-message">{message}</span>}<button disabled={saving} type="submit">{saving ? "正在保存…" : "保存订单"}</button></div>
  </form></section><aside className="order-detail-card"><h2>操作记录</h2><ol className="activity-list">{activity.length ? activity.map((item, index) => <li key={`${item.at}-${index}`}>{item.action}<time>{new Date(item.at).toLocaleString("zh-CN")}</time>{item.metadata && <small>{item.metadata}</small>}</li>) : <li>暂无记录</li>}</ol></aside></div>}</main>;
}
