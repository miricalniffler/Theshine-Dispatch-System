"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Order } from "@/features/orders/types";
import type { DriverDetails } from "./service";
import "./iway.css";

type WorkItem = { order: Order; driver: DriverDetails | null };
type Notice = { tone: "success" | "error"; message: string } | null;
type AssistResult = { status: "NOT_NEEDED" | "MANUAL_REVIEW_REQUIRED" | "SUGGESTION_READY"; message: string; value?: string; confidence?: number };

const statusText: Record<Order["status"], string> = { PENDING_REVIEW: "待核对", READY_TO_DISPATCH: "待派单", DISPATCHED: "等待司机资料", DRIVER_CONFIRMED: "可回传", RETURNED: "已回传", COMPLETED: "已完成", CANCELLED: "已取消" };

function blankDriver(): DriverDetails { return { orderId: "", rawReply: "", confirmedDriverName: null, rawDriverPhone: null, normalizedDriverPhone: null, confirmedVehicleModel: null, licensePlate: null, confirmedAt: null, driverProfileId: null, vehicleProfileId: null, driverNameSource: "MANUAL", iwayDriverName: null }; }

function bangkokTomorrowDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1)).toISOString().slice(0, 10);
}

async function copyTextWithFallback(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // iPhone Safari can reject Clipboard API calls in embedded browsers.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(field);
  return copied;
}

function DriverCard({ item, onSaved, focused = false }: { item: WorkItem; onSaved: () => void; focused?: boolean }) {
  const [form, setForm] = useState<DriverDetails>({ ...blankDriver(), ...(item.driver ?? {}), orderId: item.order.id });
  const [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [assistantNotes, setAssistantNotes] = useState<string[]>([]);
  const [vehicleImage, setVehicleImage] = useState("");
  useEffect(() => setForm({ ...blankDriver(), ...(item.driver ?? {}), orderId: item.order.id }), [item]);
  const set = (key: keyof DriverDetails, value: string) => setForm((current) => ({ ...current, [key]: value }));
  function attachVehicleImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) { setAssistantNotes(["请选择或粘贴车辆图片文件。"]); return; }
    const reader = new FileReader();
    reader.onload = () => setVehicleImage(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  }
  async function analyseReply() {
    setAnalysing(true); setAssistantNotes([]);
    try {
      const requests: Promise<AssistResult>[] = [];
      if (form.rawReply?.trim()) requests.push(fetch("/api/assist/thai-translation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: form.rawReply }) }).then((response) => response.json()).then((payload) => payload.data));
      if (vehicleImage) requests.push(fetch("/api/assist/vehicle-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: vehicleImage }) }).then((response) => response.json()).then((payload) => payload.data));
      const results = await Promise.all(requests);
      const vehicleSuggestion = results.find((result) => result?.value && result.confidence !== undefined)?.value;
      if (vehicleSuggestion && !form.confirmedVehicleModel) set("confirmedVehicleModel", vehicleSuggestion);
      const thaiCandidates = (form.rawReply ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /[\u0E00-\u0E7F]/.test(line) && !/\d{4,}|(?:tel|phone|ทะเบียน|plate)/i.test(line) && line.length <= 80);
      let nameNote = "";
      if (thaiCandidates.length) {
        const nameResponse = await fetch("/api/assist/thai-name-transliteration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: thaiCandidates }) });
        const namePayload = await nameResponse.json();
        const suggestion = namePayload.data?.names?.[0]?.english;
        if (suggestion && !form.confirmedDriverName) set("confirmedDriverName", suggestion);
        nameNote = suggestion ? `泰文姓名音译建议：${suggestion}` : (namePayload.data?.message || "未能识别可转写的泰文姓名。");
      }
      setAssistantNotes([...results.filter(Boolean).map((result) => result.value ? `${result.message} 建议：${result.value}` : result.message), ...(nameNote ? [nameNote] : [])]);
    } catch { setAssistantNotes(["分析暂时无法完成。原始回复仍已保留，请人工填写并保存。"]); }
    finally { setAnalysing(false); }
  }
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
  return <article className={`driver-card${focused ? " focused-driver-card" : ""}`}>
    <header><div><span className="order-mark">{focused ? "正在录入 · " : ""}{item.order.city} · {item.order.serviceDate} {item.order.pickupTime}</span><h2>{item.order.orderNo}</h2><p>{item.order.passengerName} · {item.order.route}</p></div><span className={`work-status ${item.order.status.toLowerCase()}`}>{statusText[item.order.status]}</span></header>
    <label className="wide-field">车队原始回复（保留原文）<textarea value={form.rawReply ?? ""} autoCapitalize="none" placeholder="粘贴车队回复；系统不会替你发送任何消息" onChange={(event) => set("rawReply", event.target.value)} onPaste={(event) => { const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/")); if (image) attachVehicleImage(image); }} /></label>
    <section className="driver-assist" aria-label="车辆图片和翻译协助" onPaste={(event) => { const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/")); if (image) { event.preventDefault(); attachVehicleImage(image); } }} tabIndex={0}>
      <div><strong>粘贴车队回复和车辆图片</strong><p>可直接从微信粘贴文字；点击此区域后也可粘贴车辆截图。系统只给出翻译和车型建议，最终以你确认保存的信息为准。</p></div>
      <label className="vehicle-upload">选择车辆图片<input aria-label="选择车辆图片" type="file" accept="image/*" onChange={(event) => attachVehicleImage(event.currentTarget.files?.[0])}/></label>
      {vehicleImage && <div className="vehicle-preview-wrap"><img className="vehicle-preview" src={vehicleImage} alt="待分析的车辆图片"/><button type="button" className="remove-vehicle-image" onClick={() => setVehicleImage("")}>删除图片</button></div>}
      <button type="button" className="assist-action" onClick={analyseReply} disabled={analysing || (!form.rawReply?.trim() && !vehicleImage)}>{analysing ? "正在分析…" : "分析并翻译"}</button>
      {assistantNotes.length > 0 && <div className="assist-notes">{assistantNotes.map((message) => <p key={message}>{message}</p>)}</div>}
    </section>
    <div className="driver-form">
      <label>司机姓名<input value={form.confirmedDriverName ?? ""} onChange={(event) => set("confirmedDriverName", event.target.value)} placeholder="例如 Somchai" /></label>
      <label>司机电话<input value={form.rawDriverPhone ?? ""} onChange={(event) => set("rawDriverPhone", event.target.value)} placeholder="例如 081-234-5678" /></label>
      <label>确认车型<input value={form.confirmedVehicleModel ?? ""} onChange={(event) => set("confirmedVehicleModel", event.target.value)} placeholder="例如 Toyota Commut" /></label>
      <label>车牌号<input value={form.licensePlate ?? ""} onChange={(event) => set("licensePlate", event.target.value)} placeholder="例如 1กข 2345" /></label>
    </div>
    {form.normalizedDriverPhone && <p className="normalized">规范后的泰国电话：<strong>{form.normalizedDriverPhone}</strong></p>}
    {notice && <p className={`inline-notice ${notice.tone}`}>{notice.message}</p>}
    <footer><small>电话和车型会按当前 YAML 规则转换；原号码不会被覆盖。</small><div className="driver-footer-actions"><Link href="/driver-details" className="driver-return-link">前往车队回传</Link><button type="button" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存并校验"}</button></div></footer>
  </article>;
}

export function DriverWorkspace() {
  const [items, setItems] = useState<WorkItem[]>([]); const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const refresh = () => fetch("/api/driver-details").then((response) => response.json()).then((payload) => setItems(payload.data)).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);
  const orderedItems = orderId ? [...items].sort((left, right) => Number(right.order.id === orderId) - Number(left.order.id === orderId)) : items;
  return <main className="workflow-page"><nav className="workflow-nav"><a href="/orders">订单</a><a className="active" href="/driver-details">车队回传</a></nav><header className="workflow-header"><p className="workflow-kicker">车队回传</p><h1>把车队回复变成可回传的信息</h1><p>{orderId ? "已打开你选择的订单。粘贴车队回复和车辆图片后，先查看建议，再确认保存。" : "确认四项资料后，系统才允许生成 i’way 回传文本。电话和车型均从规则文件读取并转换。"}</p></header>{loading ? <p className="loading">正在加载司机资料…</p> : <section className="driver-list">{orderedItems.length ? orderedItems.map((item) => <DriverCard key={item.order.id} item={item} focused={item.order.id === orderId} onSaved={refresh} />) : <p className="empty-work">没有需要确认司机资料的订单。</p>}</section>}</main>;
}

export function IwayReturnWorkspace() {
  const [items, setItems] = useState<WorkItem[]>([]); const [selected, setSelected] = useState<string[]>([]); const [preview, setPreview] = useState<{ valid: boolean; errors: string[]; text?: string; orderCount: number; ruleVersion: string } | null>(null); const [batchId, setBatchId] = useState<string | null>(null); const [notice, setNotice] = useState<Notice>(null);
  const searchParams = useSearchParams();
  const initialOrderIds = useMemo(() => (searchParams.get("orderIds") || "").split(",").filter(Boolean), [searchParams]);
  const refresh = () => fetch("/api/driver-details").then((r) => r.json()).then((payload) => setItems(payload.data));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (initialOrderIds.length && items.length) setSelected(initialOrderIds.filter((id) => items.some((item) => item.order.id === id))); }, [initialOrderIds, items]);
  const selectable = useMemo(() => items.filter((item) => ["DRIVER_CONFIRMED", "RETURNED", "COMPLETED"].includes(item.order.status)), [items]);
  const readyByDate = useMemo(() => {
    const dates = new Map<string, WorkItem[]>();
    items.filter((item) => item.order.status === "DRIVER_CONFIRMED" || item.order.status === "RETURNED").forEach((item) => dates.set(item.order.serviceDate, [...(dates.get(item.order.serviceDate) ?? []), item]));
    return [...dates.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [items]);
  const tomorrowDate = bangkokTomorrowDate();
  const tomorrowAll = useMemo(() => items.filter((item) => item.order.serviceDate === tomorrowDate && item.order.status !== "CANCELLED"), [items, tomorrowDate]);
  const tomorrowItems = useMemo(() => tomorrowAll.filter((item) => item.order.status === "DRIVER_CONFIRMED" || item.order.status === "RETURNED"), [tomorrowAll]);
  const incompleteTomorrow = tomorrowAll.filter((item) => item.order.status !== "DRIVER_CONFIRMED" && item.order.status !== "RETURNED");
  const toggle = (id: string) => { setBatchId(null); setPreview(null); setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); };
  async function createPreview() { setNotice(null); setBatchId(null); const response = await fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: selected }) }); const payload = await response.json(); setPreview(payload.data); }
  async function copy(orderIds = selected) { const response = await fetch("/api/iway-return-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) }); const payload = await response.json(); setPreview(payload.data); if (!payload.data?.valid) return; const copied = await copyTextWithFallback(payload.data.text); if (!copied) { setNotice({ tone: "error", message: "无法自动复制。请长按右侧回传内容，选择“全选”后复制。" }); return; } setBatchId(payload.data.batchId); setNotice({ tone: "success", message: "已按正确格式生成并复制。请粘贴到 i’way 发送；发送后点击下方“确认回传”。" }); }
  async function copyWholeDay(date: string, dayItems: WorkItem[]) { const orderIds = dayItems.map((item) => item.order.id); setSelected(orderIds); setNotice(null); await copy(orderIds); }
  async function copyTomorrow() {
    const orderIds = tomorrowItems.map((item) => item.order.id);
    if (!orderIds.length) return;
    setSelected(orderIds);
    setNotice(null);
    await copy(orderIds);
  }
  async function confirm() { if (!batchId) return; const response = await fetch("/api/iway-return-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) }); const payload = await response.json(); if (!response.ok) { setNotice({ tone: "error", message: payload.error?.message ?? "确认失败" }); return; } window.location.assign("/orders"); }
  function openWhatsAppShare() { if (!preview?.text) return; window.open(`https://wa.me/?text=${encodeURIComponent(preview.text)}`, "_blank", "noopener,noreferrer"); }
  return (
    <main className="workflow-page">
      <nav className="workflow-nav"><a href="/orders">订单工作台</a><a href="/driver-details">车队回传信息</a><a className="active" href="/iway-return">i’way 回传</a></nav>
      <header className="workflow-header"><p className="workflow-kicker">04 · I’WAY 回传</p><h1>明日订单一键回传，也支持单笔补发</h1><p>系统会把明日所有已确认司机资料的订单，组合为一份完整的 i’way 回复并自动复制。</p></header>
      <section className="return-grid">
        <div className="return-selection">
          <h2>一键回传明日订单</h2>
          <p>服务日期：{tomorrowDate} · 会合并明日全部待回传订单。</p>
          <button type="button" className="one-click-return" onClick={() => void copyTomorrow()} disabled={!tomorrowItems.length}>一键生成并复制明日 i’way 回传</button>
          {!tomorrowItems.length && <p className="empty-work">{tomorrowAll.length ? `明日有 ${tomorrowAll.length} 笔订单，但尚未确认完整司机资料；请先在“车队回传信息”补齐司机姓名、电话、车型和车牌。` : "明日没有订单；可在下方勾选其他日期的订单生成单笔回传。"}</p>}
          {incompleteTomorrow.length > 0 && <p className="incomplete-hint">明日还有 {incompleteTomorrow.length} 笔订单缺少司机资料；点击按钮后会列出需要补充的订单。</p>}
          <h2>单笔发送或更正</h2>
          <p>已完成订单也可勾选，用于车辆、司机或时间调整后的补发。</p>
          {selectable.length ? selectable.map(({ order, driver }) => <label className="return-order" key={order.id}><input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} /><span><strong>{order.orderNo}</strong><small>{order.city} · {order.serviceDate} {order.pickupTime} · {driver?.confirmedDriverName ?? "未确认司机"}{order.status === "COMPLETED" ? " · 已完成，可补发" : ""}</small></span></label>) : <p className="empty-work">没有可单独回传的订单。</p>}
          <button type="button" className="secondary-action" onClick={createPreview} disabled={!selected.length}>生成所选订单预览</button>
        </div>
        <div className="return-preview"><div className="preview-heading"><div><span>i’way 正确格式</span><strong>{preview?.orderCount ? `${preview.orderCount} 个订单` : "尚未生成"}</strong></div>{preview?.ruleVersion && <small>规则 {preview.ruleVersion}</small>}</div>{preview?.errors.length ? <div className="validation-errors"><strong>暂不能生成完整回传</strong>{preview.errors.map((error) => <p key={error}>{error}</p>)}</div> : preview?.text ? <pre tabIndex={0}>{preview.text}</pre> : <p className="preview-empty">点击左侧“一键回传明日订单”，系统会在这里生成整份回传内容。</p>}{notice && <p className={`inline-notice ${notice.tone}`}>{notice.message}</p>}<div className="preview-actions"><button type="button" onClick={() => void copy()} disabled={!preview?.valid}>复制回传内容</button><button type="button" className="whatsapp-share" onClick={openWhatsAppShare} disabled={!preview?.valid}>在 WhatsApp 打开</button><button type="button" className="confirm-action" onClick={confirm} disabled={!batchId}>我已在 i’way 发送，确认回传</button></div></div>
      </section>
    </main>
  );
  /* Legacy return kept below temporarily while this workspace is being simplified.
  return <main className="workflow-page"><nav className="workflow-nav"><a href="/orders">订单工作台</a><a href="/driver-details">车队回传信息</a><a className="active" href="/iway-return">i’way 回传</a></nav><header className="workflow-header"><p className="workflow-kicker">04 · I’WAY 回传</p><h1>当天订单一键回传，也支持单笔补发</h1><p>收齐车队资料后，直接生成并复制当天全部待回传订单。临时换车、重派或时间调整时，在下方勾选对应订单即可单独生成更正内容。</p></header><section className="return-grid"><div className="return-selection"><h2>一键回传当天订单</h2><p>只包含司机资料已齐全、尚未记录为完成的订单。</p>{readyByDate.length ? <div className="return-day-actions">{readyByDate.map(([date, dayItems]) => <button type="button" className="secondary-action" key={date} onClick={() => void copyWholeDay(date, dayItems)}>生成并复制 {date} 全部 {dayItems.length} 笔订单</button>)}</div> : <p className="empty-work">暂时没有资料齐全、等待回传的订单。</p>}<h2>单笔发送或更正</h2><p>已完成订单也可勾选，用于车辆、司机或时间调整后的补发。</p>{selectable.length ? selectable.map(({ order, driver }) => <label className="return-order" key={order.id}><input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} /><span><strong>{order.orderNo}</strong><small>{order.city} · {order.serviceDate} {order.pickupTime} · {driver?.confirmedDriverName ?? "未确认司机"}{order.status === "COMPLETED" ? " · 已完成，可补发" : ""}</small></span></label>) : <p className="empty-work">没有可单独回传的订单。</p>}<button type="button" className="secondary-action" onClick={createPreview} disabled={!selected.length}>生成所选订单预览</button></div><div className="return-preview"><div className="preview-heading"><div><span>i’way 正确格式</span><strong>{preview?.orderCount ? `${preview.orderCount} 个订单` : "尚未生成"}</strong></div>{preview?.ruleVersion && <small>规则 {preview.ruleVersion}</small>}</div>{preview?.errors.length ? <div className="validation-errors"><strong>暂不能生成</strong>{preview.errors.map((error) => <p key={error}>{error}</p>)}</div> : preview?.text ? <pre>{preview.text}</pre> : <p className="preview-empty">点击上方当天按钮可直接生成并复制；也可以勾选一笔或多笔订单，单独生成。</p>}{notice && <p className={`inline-notice ${notice.tone}`}>{notice.message}</p>}<div className="preview-actions"><button type="button" onClick={() => void copy()} disabled={!preview?.valid}>复制回传内容</button><button type="button" className="confirm-action" onClick={confirm} disabled={!batchId}>我已在 i’way 发送，确认回传</button></div></div></section></main>;
  */
}
