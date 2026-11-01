"use client";
import { useEffect, useState } from "react";
import type { MailReview } from "./gmail-lifecycle";
type Item = { id: string; orderId: string | null; receivedAt: string; review: MailReview | null };
const reasons: Record<string, string> = { CANCELLED_NOTIFY_FLEET: "订单已取消：需要通知车队并核实费用", ORDER_NOT_FOUND: "找不到精确匹配订单，需核查", ORDER_NUMBER_MISSING_OR_CONFLICTING: "订单号缺失或冲突，未执行取消", UNVERIFIED_SUBJECT: "邮件主题格式未确认，未自动操作", CANCELLATION_BODY_UNCONFIRMED: "取消正文未确认，未执行取消", AMENDMENT_REQUIRES_REVIEW: "修改通知待人工核对", COMPLETED_ORDER_REQUIRES_REVIEW: "订单已完成，需人工核对取消或修改", OLDER_THAN_PROCESSED_MAIL: "邮件早于已处理通知，需核对顺序" };
const labels: Record<string, string> = { pickupDateTime: "接客时间（UTC）", pickupAddress: "上车地点", dropoffAddress: "下车地点", passengerName: "乘客姓名", passengerPhone: "乘客电话", platformVehicleType: "平台车型", flightNumber: "航班", adults: "成人", meetGreetLine: "举牌", otherNotes: "备注" };
export function GmailLifecycleReviews() {
  const [items, setItems] = useState<Item[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load() { const r = await fetch("/api/import-sync/gmail-iway/reviews", { cache: "no-store" }); if (!r.ok) throw new Error("Gmail 待办读取失败"); const p = await r.json(); setItems(p.data || []); }
  useEffect(()=>{ void load().catch(e=>setError(e.message)); }, []);
  async function finish(item: Item) {
    const note = window.prompt("请记录核对结果。修改需先在订单详情手动保存；取消订单需确认已通知车队。此操作只关闭待办，不修改订单。");
    if (!note?.trim()) return;
    setBusy(true); setError("");
    try { const r = await fetch("/api/import-sync/gmail-iway/reviews", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id:item.id, decision:item.review?.reason === "CANCELLED_NOTIFY_FLEET" ? "FLEET_NOTIFIED" : "REVIEWED", note }) }); if (!r.ok) throw new Error("处理失败，请刷新后重试"); await load(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!items.length && !error) return null;
  return <section aria-label="Gmail 订单变更待办" style={{padding:16, marginBottom:16, border:"1px solid #e6b568", borderRadius:12}}><h2>Gmail 订单变更待办（{items.length}）</h2><p>修改不会自动覆盖订单。请展开核对差异，在订单详情手动修改后记录结果；已派车取消须通知车队。</p>{error && <p role="alert">{error}</p>}{items.map(item=><details key={item.id} style={{padding:10, borderTop:"1px solid #ddd"}}><summary>#{item.review?.orderNumber || "订单号待确认"} · {reasons[item.review?.reason || ""] || "需人工核对"}</summary><p>{new Date(item.receivedAt).toLocaleString("zh-CN")}{item.orderId && <> · <a href={`/orders/${item.orderId}`}>打开订单详情</a></>}</p>{item.review?.differences.length ? <table><thead><tr><th>字段</th><th>数据库当前值</th><th>邮件当前值（待确认）</th></tr></thead><tbody>{item.review.differences.map(d=><tr key={d.field}><td>{labels[d.field] || d.field}</td><td style={{whiteSpace:"pre-wrap"}}>{d.before || "空"}</td><td style={{whiteSpace:"pre-wrap"}}>{d.proposed || "空"}</td></tr>)}</tbody></table> : <p>未能可靠生成字段差异，请核查原邮件；不会据此自动修改或取消。</p>}{item.review?.fields.length ? <details><summary>邮件字段及删除线旧值</summary>{item.review.fields.map((f,i)=><p key={i}><b>{f.label}</b>：{f.current}{f.previous.length>0 && <small> · 邮件旧值：{f.previous.join(" / ")}</small>}</p>)}</details>:null}<button disabled={busy} onClick={()=>void finish(item)}>{item.review?.reason === "CANCELLED_NOTIFY_FLEET" ? "记录已通知车队" : "记录人工处理结果"}</button></details>)}</section>;
}
