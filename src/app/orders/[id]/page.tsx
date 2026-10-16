"use client";

import { FormEvent, useEffect, useState } from "react";
import "@/features/orders/order-detail.css";
import { CustomerCommunicationPanel } from "@/features/customer-notifications/CustomerCommunicationPanel";

type Detail = Record<string, any>;
async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) return { error: { message: `服务暂时无响应（${response.status}）` } };
  try { return JSON.parse(text); }
  catch { return { error: { message: `服务返回了无法识别的内容（${response.status}），请刷新后重试。` } }; }
}
function localDateTime(value?: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (name: string) => parts.find((part) => part.type === name)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function formValues(order: Detail) {
  const adults = order.adults ?? 0; const children = order.children ?? 0;
  return { platformOrderNumber: order.platformOrderNumber ?? "", city: order.city ?? "曼谷", fleetId: order.fleetId ?? "", pickupDateTime: localDateTime(order.pickupDateTime), pickupAddress: order.pickupAddress ?? "", dropoffAddress: order.dropoffAddress ?? "", passengerName: order.passengerName ?? "", passengerPhone: order.passengerPhone ?? "", flightNumber: order.flightNumber ?? "", platformVehicleType: order.platformVehicleType ?? "", seatCount: order.seatCount ?? "", adults, children, luggage: order.luggage || adults + children, childSeatLine: order.childSeatLine ?? "", meetGreetLine: order.meetGreetLine ?? "", otherNotes: order.otherNotes ?? "" };
}

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState(""); const [order, setOrder] = useState<Detail | null>(null); const [form, setForm] = useState<Record<string, any>>({});
  const [activity, setActivity] = useState<any[]>([]); const [activityOpen, setActivityOpen] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [cancelReason, setCancelReason] = useState(""); const [exceptionNote, setExceptionNote] = useState(""); const [lifecycleBusy, setLifecycleBusy] = useState(false); const [loading, setLoading] = useState(true);
  const refresh = async (orderId: string) => {
    setLoading(true); setError("");
    try {
      const [detailResponse, activityResponse] = await Promise.all([fetch(`/api/orders/${orderId}`), fetch(`/api/orders/${orderId}/activity`)]);
      const [detail, timeline] = await Promise.all([readResponse(detailResponse), readResponse(activityResponse)]);
      if (!detailResponse.ok) throw new Error(detail.error?.message ?? "订单读取失败，请稍后重试。");
      if (!activityResponse.ok) throw new Error(timeline.error?.message ?? "操作记录读取失败，请稍后重试。");
      setOrder(detail.data); setForm(formValues(detail.data)); setActivity(timeline.data ?? []);
    } catch (err) { setOrder(null); setActivity([]); setError(err instanceof Error ? err.message : "订单读取失败，请稍后重试。"); }
    finally { setLoading(false); }
  };
  useEffect(() => { params.then(({ id: orderId }) => { setId(orderId); void refresh(orderId); }); }, [params]);
  const change = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage(""); setSaving(true);
    const body = { ...form, fleetId: form.fleetId || null, seatCount: form.seatCount === "" ? null : Number(form.seatCount), adults: Number(form.adults), children: Number(form.children), luggage: Number(form.luggage) };
    const response = await fetch(`/api/orders/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await readResponse(response); setSaving(false);
    if (!response.ok) { setError(data.error?.message ?? "保存失败，请稍后重试。"); return; }
    // API responses wrap their payload in `data`. Reading the top-level field
    // made a successful edit look like a no-op to operators.
    setMessage(data.data?.updatedFields?.length ? "已保存订单信息，并记录本次修改。" : "没有需要保存的修改。"); await refresh(id);
  };
  async function submitLifecycle(action: "cancel" | "notes") {
    if (!id) return;
    const value = action === "cancel" ? cancelReason.trim() : exceptionNote.trim();
    if (!value) { setError(action === "cancel" ? "请先填写取消原因。" : "请先填写异常备注。"); return; }
    if (action === "cancel" && !window.confirm("确认取消此订单？订单和历史记录会保留，无法通过此页面恢复。")) return;
    setLifecycleBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/orders/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "cancel" ? { reason: value } : { note: value }) });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error?.message || "操作失败");
      setMessage(action === "cancel" ? "订单已取消，历史记录已保留。" : "异常备注已保存到操作记录。");
      if (action === "cancel") setCancelReason(""); else setExceptionNote("");
      await refresh(id); setActivityOpen(true);
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
    finally { setLifecycleBusy(false); }
  }
  function activityDetail(item: any) {
    if (!item.metadata) return "";
    try {
      const data = JSON.parse(item.metadata);
      if (data.note) return String(data.note);
      if (data.reason) return `原因：${data.reason}`;
      if (data.changes) return Object.entries(data.changes).map(([field, change]) => {
        const values = change as { from?: unknown; to?: unknown };
        return `${field}: ${String(values.from ?? "空")} → ${String(values.to ?? "空")}`;
      }).join("；");
      return item.metadata;
    } catch { return item.metadata; }
  }
  return <main className="rules-page"><nav><a href="/orders">订单工作台</a><a className="active" href="#">订单详情</a></nav><header><p>订单详情</p><h1>{loading ? "正在读取订单…" : order?.platformOrderNumber || "订单暂时无法读取"}</h1></header>{error && <section className="order-detail-card"><p className="order-error">{error}</p><button type="button" onClick={() => id && void refresh(id)}>重试读取</button><a className="order-cancel-link" href="/orders">返回订单工作台</a></section>}{order && <><div className="order-detail-grid"><section className="order-detail-card"><h2>编辑订单{order.status === "CANCELLED" ? " · 已取消" : ""}</h2>{error && <p className="order-error">{error}</p>}<form className="order-edit-form" onSubmit={save}><fieldset disabled={order.status === "CANCELLED" || saving} style={{ display: "contents" }}>
    <label>平台订单号<input value={form.platformOrderNumber} onChange={(e) => change("platformOrderNumber", e.target.value)} required /></label><label>服务城市<select value={form.city} onChange={(e) => change("city", e.target.value)}><option value="曼谷">曼谷</option><option value="苏梅">苏梅</option></select></label>
    <label>接客日期与时间<input type="datetime-local" value={form.pickupDateTime} onChange={(e) => change("pickupDateTime", e.target.value)} required /><span className="hint">按泰国当地时间填写</span></label><label>派送车队<input value={form.city === "苏梅" ? "苏梅车队（自动分配）" : "曼谷车队（自动分配）"} disabled /></label>
    <label>乘客姓名<input value={form.passengerName} onChange={(e) => change("passengerName", e.target.value)} required /></label><label>乘客电话<input value={form.passengerPhone} onChange={(e) => change("passengerPhone", e.target.value)} required /></label><label>航班号<input value={form.flightNumber} onChange={(e) => change("flightNumber", e.target.value)} /></label><label>平台车型<input value={form.platformVehicleType} onChange={(e) => change("platformVehicleType", e.target.value)} required /></label>
    <label>座位数<input type="number" min="0" value={form.seatCount} onChange={(e) => change("seatCount", e.target.value)} /></label><label>成人 / 儿童 / 行李<div className="passenger-count-fields"><input aria-label="成人" type="number" min="0" value={form.adults} onChange={(e) => change("adults", e.target.value)} /><input aria-label="儿童" type="number" min="0" value={form.children} onChange={(e) => change("children", e.target.value)} /><input aria-label="行李" type="number" min="0" value={form.luggage} onChange={(e) => change("luggage", e.target.value)} /></div><span className="hint">未特别说明时，行李默认等于乘客总人数。</span></label>
    <label className="full-width">上车地点<textarea value={form.pickupAddress} onChange={(e) => change("pickupAddress", e.target.value)} required /></label><label className="full-width">下车地点<textarea value={form.dropoffAddress} onChange={(e) => change("dropoffAddress", e.target.value)} required /></label><label>儿童座椅说明<textarea value={form.childSeatLine} onChange={(e) => change("childSeatLine", e.target.value)} /></label><label>举牌 / 接机说明<textarea value={form.meetGreetLine} onChange={(e) => change("meetGreetLine", e.target.value)} placeholder="填写 Meet&Greet，或填写接机牌上的姓名" /><span className="hint">填写姓名且与乘客不同，会生成 Meet with greeting sign 姓名。</span></label><label className="full-width">其他备注<textarea value={form.otherNotes} onChange={(e) => change("otherNotes", e.target.value)} /></label>
    <div className="order-edit-actions full-width">{message && <span className="order-save-message">{message}</span>}<a className="order-cancel-link" href="/orders">取消</a><button disabled={saving} type="submit">{saving ? "正在保存…" : "保存订单"}</button></div></fieldset>
  </form></section><aside className="order-detail-card order-activity-card"><button type="button" className="order-activity-toggle" onClick={() => setActivityOpen((open) => !open)} aria-expanded={activityOpen}>{activityOpen ? "收起操作记录" : "查看操作记录"}</button>{activityOpen && <ol className="activity-list">{activity.length ? activity.map((item, index) => <li key={`${item.at}-${index}`}>{item.action}<time>{new Date(item.at).toLocaleString("zh-CN")}</time>{item.metadata && <small style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{activityDetail(item)}</small>}</li>) : <li>暂无记录</li>}</ol>}
      <section style={{ marginTop: 24 }}><h3>异常备注</h3><textarea aria-label="异常备注" value={exceptionNote} maxLength={2000} rows={4} onChange={(e) => setExceptionNote(e.target.value)} placeholder="记录司机、客人、车队或平台异常情况" style={{ width: "100%" }} /><button type="button" disabled={lifecycleBusy || !exceptionNote.trim()} onClick={() => void submitLifecycle("notes")}>保存异常备注</button></section>
      <section style={{ marginTop: 24 }}><h3>取消订单</h3>{order.status === "CANCELLED" ? <p>此订单已取消，数据及操作记录仍然保留。</p> : <><textarea aria-label="取消原因" value={cancelReason} maxLength={500} rows={3} onChange={(e) => setCancelReason(e.target.value)} placeholder="填写取消原因（必填）" style={{ width: "100%" }} /><button type="button" disabled={lifecycleBusy || !cancelReason.trim()} onClick={() => void submitLifecycle("cancel")}>确认取消订单</button></>}</section>
      </aside></div><CustomerCommunicationPanel orderId={id} /></>}</main>;
}
