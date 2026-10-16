"use client";

import { useEffect, useState } from "react";
import "./dispatch-preview.css";

type DispatchPreview = { valid: boolean; errors: string[]; text?: string; city?: string; fleetName?: string; serviceDate?: string; ruleVersion: string; orderCount: number };
type ApiResponse = { data?: DispatchPreview; error?: { message?: string } };

async function readApiResponse(response: Response) {
  const text = await response.text();
  if (!text) return { error: { message: `服务暂时无响应（${response.status}），请刷新后重试。` } };
  try { return JSON.parse(text); }
  catch { return { error: { message: `服务返回异常内容（${response.status}），请刷新后重试。` } }; }
}

async function copyTextWithFallback(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {
    // iPhone Safari can reject Clipboard API calls in an embedded browser.
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

export function DispatchPreviewDialog({ orderIds, onClose, mode = "batch", editHref }: { orderIds: string[]; onClose: () => void; mode?: "batch" | "single"; editHref?: string }) {
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [copied, setCopied] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setRequestError("");
    fetch("/api/dispatch-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds, mode }), signal: controller.signal })
      .then(async (response) => {
        const body = await readApiResponse(response) as ApiResponse;
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
      const copiedText = await copyTextWithFallback(preview.text);
      if (!copiedText) throw new Error("无法自动复制。请长按派单文本，选择全选后复制。");
      if (mode === "single") { setCopied(true); window.setTimeout(() => setCopied(false), 1800); return; }
      const response = await fetch("/api/dispatch-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) });
      const payload = await readApiResponse(response);
      if (!payload.data?.batchId) throw new Error(payload.error?.message || "无法保存复制记录。");
      setBatchId(payload.data.batchId);
      setCopied(true); window.setTimeout(() => setCopied(false), 1800);
    }
    catch (error) { setRequestError(error instanceof Error ? error.message : "无法自动复制。请长按派单文本，选择全选后复制。"); }
  }

  async function confirmDispatchCopy() {
    if (!batchId) return;
    setConfirming(true); setRequestError("");
    try {
      const response = await fetch("/api/dispatch-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.error?.message || "派单确认失败，请刷新后重试。");
      setConfirmed(true);
    } catch (error) { setRequestError(error instanceof Error ? error.message : "派单确认失败，请刷新后重试。"); }
    finally { setConfirming(false); }
  }

  function openWhatsAppShare() {
    if (!preview?.text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(preview.text)}`, "_blank", "noopener,noreferrer");
  }

  return <div className="dispatch-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-preview-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="dispatch-modal-header"><div><p>{mode === "single" ? "单条订单" : "车队派单"}</p><h2 id="dispatch-preview-title">{mode === "single" ? "派单信息预览" : "生成派单预览"}</h2></div><button className="dispatch-close" type="button" aria-label="关闭派单预览" onClick={onClose}>×</button></header>
      {loading && <div className="dispatch-loading">正在按当前业务规则核对订单并生成文本…</div>}
      {requestError && <div className="dispatch-request-error" role="alert">{requestError}</div>}
      {preview && !preview.valid && <div className="dispatch-validation-error" role="alert"><h3>暂时不能生成派单</h3><p>请调整所选订单，或先处理以下问题：</p><ul>{preview.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul><small>规则版本：{preview.ruleVersion}</small></div>}
      {preview?.valid && <><div className="dispatch-meta" aria-label="派单批次信息"><span><b>{preview.orderCount}</b> 个订单</span><span>{preview.city}</span><span>{preview.fleetName}</span><span>{preview.serviceDate}</span></div><p className="dispatch-help">{mode === "single" ? "以下为该订单的统一派单正文。发现信息不对时，可直接打开订单编辑页修改。" : "先复制派单文本；仅在你已经自行发送给车队后，再点击“确认已派单”。系统不会替你发送任何消息。"}</p><textarea className="dispatch-text" aria-label="派单文本预览" readOnly value={preview.text || ""} /><footer className="dispatch-modal-footer"><small>规则版本：{preview.ruleVersion}</small><div><button className="dispatch-secondary" type="button" onClick={() => editHref ? window.location.assign(editHref) : onClose()}>{mode === "single" ? "打开订单编辑页" : "完成"}</button><button className="dispatch-primary" type="button" onClick={copyText}>{copied ? "已复制" : "复制派单文本"}</button>{mode === "batch" && <button className="dispatch-primary" type="button" disabled={!batchId || confirming || confirmed} onClick={() => void confirmDispatchCopy()}>{confirmed ? "已确认派单" : confirming ? "正在确认…" : "我已派单，确认状态"}</button>}<button className="dispatch-whatsapp" type="button" onClick={openWhatsAppShare}>在 WhatsApp 打开</button></div></footer></>}
      {!loading && !preview?.valid && <footer className="dispatch-modal-footer dispatch-footer-single"><button className="dispatch-secondary" type="button" onClick={onClose}>返回订单列表</button></footer>}
    </section>
  </div>;
}
