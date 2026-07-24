"use client";

import { useEffect, useState } from "react";
import "./dispatch-preview.css";

type DispatchPreview = { valid: boolean; errors: string[]; text?: string; city?: string; fleetName?: string; serviceDate?: string; ruleVersion: string; orderCount: number };
type ApiResponse = { data?: DispatchPreview; error?: { message?: string } };

export function DispatchPreviewDialog({ orderIds, onClose, mode = "batch", onOpenOrderDetail }: { orderIds: string[]; onClose: () => void; mode?: "batch" | "single"; onOpenOrderDetail?: () => void }) {
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [copied, setCopied] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setRequestError("");
    fetch("/api/dispatch-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds, mode }), signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({} as ApiResponse));
        if (!response.ok && !body.data) throw new Error(body.error?.message || "暂时无法生成派单预览，请稍后再试。");
        return body.data as DispatchPreview;
      })
      .then(setPreview)
      .catch((error: Error) => { if (error.name !== "AbortError") setRequestError(error.message); })
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [orderIds]);

  async function copyText() {
    if (!preview?.text) return;
    try {
      await navigator.clipboard.writeText(preview.text);
      if (mode === "single") { setCopied(true); window.setTimeout(() => setCopied(false), 1800); return; }
      const response = await fetch("/api/dispatch-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) });
      const payload = await response.json();
      if (!payload.data?.batchId) throw new Error(payload.error?.message || "无法保存复制记录。");
      setBatchId(payload.data.batchId); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
    }
    catch { setRequestError("无法自动复制。请手动选中文本后复制。"); }
  }

  async function confirmSent() {
    if (!batchId) return;
    const response = await fetch("/api/dispatch-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) });
    const payload = await response.json();
    if (!response.ok) { setRequestError(payload.error?.message || "确认派单失败。"); return; }
    setConfirmed(true);
  }

  return <div className="dispatch-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-preview-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="dispatch-modal-header"><div><p>{mode === "single" ? "单条订单" : "车队派单"}</p><h2 id="dispatch-preview-title">{mode === "single" ? "派单信息预览" : "生成派单预览"}</h2></div><button className="dispatch-close" type="button" aria-label="关闭派单预览" onClick={onClose}>×</button></header>
      {loading && <div className="dispatch-loading">正在按当前业务规则核对订单并生成文本…</div>}
      {requestError && <div className="dispatch-request-error" role="alert">{requestError}</div>}
      {preview && !preview.valid && <div className="dispatch-validation-error" role="alert"><h3>暂时不能生成派单</h3><p>请调整所选订单，或先处理以下问题：</p><ul>{preview.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul><small>规则版本：{preview.ruleVersion}</small></div>}
      {preview?.valid && <><div className="dispatch-meta" aria-label="派单批次信息"><span><b>{preview.orderCount}</b> 个订单</span><span>{preview.city}</span><span>{preview.fleetName}</span><span>{preview.serviceDate}</span></div><p className="dispatch-help">{mode === "single" ? "以下为该订单的统一派单正文，不含仅在批量操作时添加的城市尾注。发现信息不对时，请打开订单详情修改。" : "以下内容已按统一订单正文和当前城市尾注生成。复制后请在微信或 WhatsApp 中人工发送。"}</p><textarea className="dispatch-text" aria-label="派单文本预览" readOnly value={preview.text || ""} />{confirmed && <p className="dispatch-confirmed">已记录人工派单时间，订单现为“等待司机资料”。</p>}<footer className="dispatch-modal-footer"><small>规则版本：{preview.ruleVersion}</small><div><button className="dispatch-secondary" type="button" onClick={mode === "single" ? onOpenOrderDetail : onClose}>{mode === "single" ? "打开订单详情并编辑" : "返回修改"}</button><button className="dispatch-primary" type="button" onClick={copyText}>{copied ? "已复制" : "复制派单文本"}</button>{mode === "batch" && <button className="dispatch-confirm" type="button" onClick={confirmSent} disabled={!batchId || confirmed}>我已发送给车队</button>}</div></footer></>}
      {!loading && !preview?.valid && <footer className="dispatch-modal-footer dispatch-footer-single"><button className="dispatch-secondary" type="button" onClick={onClose}>返回订单列表</button></footer>}
    </section>
  </div>;
}
