"use client";

import { useEffect, useState } from "react";
import "@/features/dispatch/dispatch-preview.css";

type Preview = { valid: boolean; errors: string[]; text?: string; orderCount: number; serviceDate?: string; ruleVersion: string };

export function IwayPreviewDialog({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) })
      .then((response) => response.json()).then((payload) => setPreview(payload.data));
  }, [orderIds]);
  async function copy() {
    const response = await fetch("/api/iway-return-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) });
    const payload = await response.json();
    if (!payload.data?.valid) { setPreview(payload.data); return; }
    await navigator.clipboard.writeText(payload.data.text);
    setBatchId(payload.data.batchId); setMessage("完整内容已复制；订单状态没有改变。请人工发送后再确认。");
  }
  async function confirm() {
    if (!batchId) return;
    const response = await fetch("/api/iway-return-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) });
    const payload = await response.json();
    setMessage(response.ok ? "已记录人工回传时间，所选订单已完成。" : payload.error?.message || "确认失败。");
  }
  return <div className="dispatch-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="iway-title" onMouseDown={(event) => event.stopPropagation()}>
    <header className="dispatch-modal-header"><div><p>i’way 回传</p><h2 id="iway-title">批量回传 i’way</h2></div><button className="dispatch-close" aria-label="关闭回传预览" onClick={onClose}>×</button></header>
    {!preview && <div className="dispatch-loading">正在校验司机资料并生成回传文本…</div>}
    {preview && !preview.valid && <div className="dispatch-validation-error" role="alert"><h3>暂时不能生成回传</h3><ul>{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
    {preview?.valid && <><div className="dispatch-meta"><span><b>{preview.orderCount}</b> 个订单</span><span>{preview.serviceDate}</span></div><textarea className="dispatch-text" aria-label="iway 回传文本预览" readOnly value={preview.text || ""}/>{message && <p className="dispatch-confirmed">{message}</p>}<footer className="dispatch-modal-footer"><small>规则版本：{preview.ruleVersion}</small><div><button className="dispatch-secondary" onClick={onClose}>返回修改</button><button className="dispatch-primary" onClick={copy}>复制完整内容</button><button className="dispatch-confirm" disabled={!batchId} onClick={confirm}>确认已回传 i’way</button></div></footer></>}
  </section></div>;
}
