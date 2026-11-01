"use client";

import { useMemo, useState } from "react";
import "./vehicle-monitoring.css";

type Item = { id: string; orderNo: string; pickupAt: string; platformGrade: string; country: string | null; passengers: number; luggage: number; luggageSource: string; vehicle: string | null; status: string; reason: string | null; override: boolean };

const label: Record<string, string> = { COMPLIANT: "符合", REVIEW_REQUIRED: "待核对", NON_COMPLIANT: "不符合" };
function urgency(pickupAt: string) {
  const hours = (new Date(pickupAt).getTime() - Date.now()) / 3600000;
  if (hours < 0) return "";
  if (hours < 2) return "red";
  if (hours < 6) return "orange";
  if (hours < 24) return "yellow";
  return "green";
}

export function VehicleMonitoringWorkbench({ initial, standardCount }: { initial: Item[]; standardCount: number }) {
  const [items, setItems] = useState(initial); const [filter, setFilter] = useState("ACTION"); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const shown = useMemo(() => filter === "ALL" ? items : items.filter((item) => item.status !== "COMPLIANT" || item.override), [items, filter]);
  async function refresh() {
    const response = await fetch("/api/vehicle-monitoring", { cache: "no-store" }); const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "刷新失败");
    setItems(payload.data.orders.map((order: any) => ({ id: order.id, orderNo: order.platformOrderNumber, pickupAt: order.pickupDateTime, platformGrade: order.platformVehicleType, country: order.serviceCountry, passengers: order.adults + order.children, luggage: order.luggage, luggageSource: order.luggageSource, vehicle: order.driverDetail?.confirmedVehicleModel ?? null, status: order.vehicleAssessments[0]?.status ?? "REVIEW_REQUIRED", reason: order.vehicleAssessments[0]?.reason ?? "尚未生成审核", override: Boolean(order.vehicleOverrides[0]) })));
  }
  async function importStandards() { setBusy(true); try { const response = await fetch("/api/vehicle-monitoring/standards/import", { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "导入失败"); setNotice(`已处理 ${payload.data.totalSourceRows} 条初始标准；新增容量组合 ${payload.data.imported} 条。`); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "导入失败"); } finally { setBusy(false); } }
  async function release(item: Item) { const reason = window.prompt("单次放行原因（必填；车型、人数、行李或规则变化后会自动失效）："); if (!reason?.trim()) return; setBusy(true); try { const response = await fetch(`/api/orders/${item.id}/vehicle-assessment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", reason }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "放行失败"); setNotice("已记录单次放行；它只适用于当前订单的当前条件。"); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "放行失败"); } finally { setBusy(false); } }
  return <main className="page-shell vehicle-monitoring"><header className="page-header"><div><p className="eyebrow">车型监控</p><h1>车型审核工作台</h1><p>司机资料始终可以保存；只有明确不符合且未放行的订单会被阻止新增 iWay 回传。</p></div><div><button type="button" onClick={() => void importStandards()} disabled={busy}>导入 Excel 初始标准</button><button type="button" onClick={() => void refresh()} disabled={busy}>刷新审核</button></div></header>{notice && <p className="status-banner">{notice}</p>}<section className="monitoring-toolbar"><span>已载入 {standardCount} 条车型配置</span><label>查看 <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ACTION">需要处理</option><option value="ALL">全部未完成订单</option></select></label></section><section className="monitoring-list">{shown.map((item) => <article key={item.id} className={`monitoring-card ${item.status.toLowerCase()}`}><i className={`urgency ${item.status === "COMPLIANT" ? "" : urgency(item.pickupAt)}`} aria-label="接送时间紧急程度" /><div><strong>{item.orderNo}</strong><p>{new Date(item.pickupAt).toLocaleString("zh-CN")} · {item.country || "国家待确认"}</p><p>平台等级：{item.platformGrade}　实际车型：{item.vehicle || "未派车"}</p><p>{item.passengers} 人 · {item.luggage} 件行李（{item.luggageSource === "ACTUAL" ? "实际" : item.luggageSource === "ESTIMATED" ? "预计" : "未知"}）</p><p className="assessment-reason">{label[item.status] ?? "待核对"}：{item.reason || "无异常"}{item.override ? "（已有单次放行）" : ""}</p></div>{item.status === "NON_COMPLIANT" && !item.override && <button type="button" disabled={busy} onClick={() => void release(item)}>单次放行</button>}</article>)}{!shown.length && <p>当前筛选没有需要处理的订单。</p>}</section></main>;
}
