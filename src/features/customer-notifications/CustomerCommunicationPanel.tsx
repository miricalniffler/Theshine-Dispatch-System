"use client";

import { useEffect, useState } from "react";

type Communication = { notifications: Array<{ id: string; notificationType: string; status: string; contentSnapshot?: { text?: string } | null; createdAt: string; driverVehicleSnapshot?: Record<string, string | null> | null; airportGuideSnapshot?: { airportName?: string } | null }>; replies: Array<{ id: string; rawText: string; parseStatus: string; parsedSnapshot?: Record<string, unknown> | null; receivedAt: string }>; exceptions: Array<{ id: string; exceptionType: string; label: string; severity: string; status: string; createdAt: string }> };

const notificationLabel: Record<string, string> = { FIRST_CONTACT: "首联", DRIVER_INFO: "司机资料", DRIVER_INFO_UPDATE: "司机资料更新" };

export function CustomerCommunicationPanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Communication | null>(null); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState("");
  const [openText, setOpenText] = useState<string | null>(null); const [replyText, setReplyText] = useState(""); const [busy, setBusy] = useState(false);
  async function refresh() { setLoading(true); const response = await fetch(`/api/orders/${orderId}/customer-communication`, { cache: "no-store" }); const payload = await response.json().catch(() => ({})); if (response.ok) setData(payload.data); else setNotice(payload.error?.message || "无法读取客户沟通记录。"); setLoading(false); }
  useEffect(() => { void refresh(); }, [orderId]);
  async function action(action: "prepare-first-contact" | "prepare-driver-info") {
    setBusy(true); setNotice(""); const response = await fetch(`/api/orders/${orderId}/customer-communication`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, regenerate: action === "prepare-first-contact" }) }); const payload = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setNotice(payload.error?.message || "无法生成待发送内容。"); return; }
    const result = payload.data; setNotice(result?.reason === "REGION_DISABLED" ? "该区域的客户通知开关目前为 OFF，未生成任何客人通知。" : result?.reason === "MISSING_PHONE" ? "缺少有效国际客人电话，已保留给运营人员处理。" : "已生成内部待发送内容；尚未通过 WhatsApp 发送。"); await refresh();
  }
  async function submitReply() {
    if (!replyText.trim()) return; setBusy(true); setNotice(""); const response = await fetch(`/api/orders/${orderId}/customer-replies`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rawText: replyText }) }); const payload = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setNotice(payload.error?.message || "无法保存客人回复。"); return; } setReplyText(""); setNotice(`已保存客人原话，并以${payload.data?.result?.parser === "RULE" ? "简单规则" : payload.data?.result?.parser === "QWEN" ? "结构化 AI 理解" : "人工复核"}处理；系统没有自动回复或改订单。`); await refresh();
  }
  return <section className="customer-communication-panel order-detail-card"><header><div><p>客户沟通</p><h2>联系、回复与司机通知</h2></div><span>内部准备模式</span></header><p className="customer-communication-intro">目前只生成和保存待发送内容，不会真实发送 WhatsApp。客户原话可在下方录入，系统只理解、不自动回复，也不会改动原订单。</p>
    <div className="customer-communication-actions"><button type="button" disabled={busy} onClick={() => void action("prepare-first-contact")}>重新生成首联</button><button type="button" disabled={busy} onClick={() => void action("prepare-driver-info")}>重新生成司机资料通知</button></div>
    {notice && <p className="customer-communication-notice">{notice}</p>}
    {loading ? <p>正在读取客户沟通记录…</p> : <><section><h3>首联与司机通知</h3>{data?.notifications.length ? <ul className="customer-timeline">{data.notifications.map((item) => <li key={item.id}><div><strong>{notificationLabel[item.notificationType] || item.notificationType}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.status === "PENDING" ? "内部待发送，未真实发送" : item.status}</small></div><button type="button" onClick={() => setOpenText(openText === item.id ? null : item.id)}>{openText === item.id ? "收起" : "查看内容"}</button>{openText === item.id && <pre>{item.contentSnapshot?.text || "未保存可显示的文字快照。"}</pre>}{item.airportGuideSnapshot?.airportName && <small>已关联机场指引：{item.airportGuideSnapshot.airportName}</small>}</li>)}</ul> : <p className="customer-empty">尚未生成客户通知内容。</p>}</section>
      <section><h3>客人回复</h3><label className="customer-reply-input">录入客人原始回复（内部测试/人工登记）<textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="粘贴客人回复原文；系统不会向客人自动回复。" /><button type="button" disabled={busy || !replyText.trim()} onClick={() => void submitReply()}>保存并理解</button></label>{data?.replies.length ? <ul className="customer-timeline">{data.replies.map((item) => <li key={item.id}><strong>{item.parseStatus === "RULE_PARSED" ? "规则已理解" : item.parseStatus === "AI_PARSED" ? "AI 已结构化理解" : "等待人工查看"}</strong><small>{new Date(item.receivedAt).toLocaleString("zh-CN")}</small><blockquote>{item.rawText}</blockquote>{item.parsedSnapshot && <details><summary>查看解析结果</summary><pre>{JSON.stringify(item.parsedSnapshot, null, 2)}</pre></details>}</li>)}</ul> : <p className="customer-empty">还没有保存客人回复。</p>}</section>
      <section><h3>需要处理的沟通问题</h3>{data?.exceptions.filter((item) => item.status === "OPEN").length ? <ul className="customer-exceptions">{data.exceptions.filter((item) => item.status === "OPEN").map((item) => <li key={item.id} className={item.severity === "HIGH" ? "high" : ""}><strong>{item.label}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></li>)}</ul> : <p className="customer-empty">当前没有需要处理的客户沟通问题。</p>}</section></>}
  </section>;
}
