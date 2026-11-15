"use client";
import { useEffect, useState } from "react";

type Snapshot = { id: string; kind: string; changedFields: unknown; sourceReceivedAt: string | null; appliedAt: string; rolledBackAt: string | null };
export function GmailOrderHistory({ orderId }: { orderId: string }) {
  const [items, setItems] = useState<Snapshot[]>([]); const [notice, setNotice] = useState("");
  const load = async () => { const response = await fetch(`/api/orders/${orderId}/gmail-changes`, { cache: "no-store" }); const payload = await response.json(); if (response.ok) setItems(payload.data || []); };
  useEffect(() => { void load(); }, [orderId]);
  if (!items.length) return null;
  async function rollback(id: string) { if (!window.confirm("只会在订单此后没有任何改动时回滚；发生冲突将拒绝操作。")) return; const response = await fetch(`/api/orders/${orderId}/gmail-changes/${id}/rollback`, { method: "POST" }); const payload = await response.json(); setNotice(response.ok ? "已回滚，并保留新的审计记录。" : payload.error?.message || "回滚失败"); if (response.ok) await load(); }
  return <section className="order-detail-card" aria-label="Gmail 修改历史"><h2>Gmail 修改历史</h2>{notice && <p>{notice}</p>}<ol className="activity-list">{items.map((item) => <li key={item.id}><b>{item.kind === "CANCEL" ? "Gmail 取消" : item.kind === "AMEND" ? "Gmail 自动修改" : "回滚"}</b><time>{new Date(item.appliedAt).toLocaleString("zh-CN")}</time><small>字段：{Array.isArray(item.changedFields) ? item.changedFields.join("、") : "—"}{item.sourceReceivedAt ? ` · 邮件时间：${new Date(item.sourceReceivedAt).toLocaleString("zh-CN")}` : ""}</small>{item.kind !== "ROLLBACK" && !item.rolledBackAt && <button type="button" onClick={() => void rollback(item.id)}>回滚本次修改</button>}{item.rolledBackAt && <small>已回滚</small>}</li>)}</ol></section>;
}
