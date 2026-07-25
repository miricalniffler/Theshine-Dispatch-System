"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import "@/features/iway/iway.css";

type Context = { id: string; city: string; fleetName: string; serviceDate: string; orderIds: string[]; orders: { id: string; orderNo: string; passengerName: string }[] };
type ReplyRecord = { source_index: number; order_match: { platform_order_number: string | null; confidence: string; evidence: string }; driver_name: { value: string | null; evidence: string }; driver_phone: { value: string | null; evidence: string }; license_plate: { value: string | null; evidence: string }; vehicle_category: { value: string | null; evidence: string }; vehicle_model: { value: string | null; evidence: string }; needs_review: boolean; review_reasons: string[] };
type Result = { translation_zh: string; records: ReplyRecord[]; unmatched_items: { source_type: string; source_id: string; reason: string }[] };
type Editable = { selected: boolean; orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleModel: string };

function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }

export function FleetReplyWorkspace() {
  const searchParams = useSearchParams();
  const requestedOrderId = searchParams.get("orderId");
  const [contexts, setContexts] = useState<Context[]>([]); const [contextId, setContextId] = useState("");
  const [rawText, setRawText] = useState(""); const [images, setImages] = useState<{ dataUrl: string; filename: string; mimeType: string }[]>([]);
  const [replyId, setReplyId] = useState<string | null>(null); const [extractionId, setExtractionId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null); const [forms, setForms] = useState<Editable[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null); const [working, setWorking] = useState(false);
  useEffect(() => { fetch("/api/fleet-replies/contexts").then((r) => r.json()).then((payload) => { const list = payload.data as Context[]; setContexts(list); const initial = requestedOrderId ? list.find((item) => item.orderIds.includes(requestedOrderId)) : list[0]; setContextId(initial?.id ?? ""); }).catch(() => setNotice({ tone: "error", text: "无法读取待回传的车队批次。" })); }, [requestedOrderId]);
  const context = useMemo(() => contexts.find((item) => item.id === contextId) ?? null, [contexts, contextId]);
  async function selectImages(files: FileList | null) { if (!files) return; const next = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(async (file) => ({ dataUrl: await fileToDataUrl(file), filename: file.name, mimeType: file.type }))); setImages((current) => [...current, ...next]); }
  function formsFromResult(value: Result, orderContext: Context) {
    return value.records.map((record) => {
      const matched = orderContext.orders.find((order) => order.orderNo.replace(/\D/g, "") === (record.order_match.platform_order_number ?? "").replace(/\D/g, ""));
      return { selected: false, orderId: matched?.id ?? "", driverName: record.driver_name.value ?? "", driverPhone: record.driver_phone.value ?? "", licensePlate: record.license_plate.value ?? "", vehicleModel: record.vehicle_model.value ?? "" };
    });
  }
  async function saveAndAnalyze() {
    if (!context) { setNotice({ tone: "error", text: "请先选择车队派单批次。" }); return; }
    setWorking(true); setNotice(null); setResult(null); setForms([]);
    try {
      const create = await fetch("/api/fleet-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dispatchBatchId: context.id, orderIds: context.orderIds, rawText, images }) });
      const created = await create.json(); if (!create.ok) throw new Error(created.error?.message || "无法保存原始回复。");
      setReplyId(created.data.id);
      const analyze = await fetch(`/api/fleet-replies/${created.data.id}/analyze`, { method: "POST" }); const analysed = await analyze.json();
      if (analysed.data?.status !== "SUCCEEDED") { setNotice({ tone: "error", text: analysed.data?.message || "AI 识别未完成；原始资料已保存，可在配置服务后重试。" }); return; }
      setExtractionId(analysed.data.extractionId); setResult(analysed.data.result); setForms(formsFromResult(analysed.data.result, context)); setNotice({ tone: "success", text: "AI 已生成建议。请逐笔勾选并确认后才会写入订单。" });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "分析失败。" }); }
    finally { setWorking(false); }
  }
  function setForm(index: number, key: keyof Editable, value: string | boolean) { setForms((current) => current.map((form, position) => position === index ? { ...form, [key]: value } : form)); }
  async function confirm() {
    if (!replyId) return; const records = forms.filter((form) => form.selected); if (!records.length) { setNotice({ tone: "error", text: "请勾选至少一笔你已核对的订单。" }); return; }
    setWorking(true); const response = await fetch(`/api/fleet-replies/${replyId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractionId, records }) }); const payload = await response.json(); setWorking(false);
    if (!response.ok || !payload.data?.valid) { setNotice({ tone: "error", text: payload.data?.errors?.map((item: { message: string }) => item.message).join("；") || payload.error?.message || "确认写入失败。" }); return; }
    setNotice({ tone: "success", text: `已确认写入 ${payload.data.confirmed} 笔订单；它们现在可生成 i’way 回传。` });
  }
  return <main className="workflow-page fleet-reply-page"><nav className="workflow-nav"><a href="/orders">订单工作台</a><a className="active" href="/driver-details">车队回传信息</a><a href="/iway-return">i’way 回传</a></nav><header className="workflow-header"><p className="workflow-kicker">03 · 车队回传信息</p><h1>粘贴车队回复，AI 整理后由你确认</h1><p>原文、图片、AI 建议与最终写入值会分别保留。AI 不会自动修改订单，也不会代你发送任何信息。</p></header>
    <section className="fleet-reply-context"><label>本次回复所属派单批次<select value={contextId} onChange={(event) => { setContextId(event.target.value); setResult(null); setForms([]); setNotice(null); }}>{contexts.length ? contexts.map((item) => <option value={item.id} key={item.id}>{item.serviceDate} · {item.city} · {item.fleetName} · {item.orders.map((order) => order.orderNo).join("、")}</option>) : <option value="">暂无待回传车队批次</option>}</select></label>{context && <div className="reply-order-context"><strong>本次只能匹配以下订单：</strong>{context.orders.map((order) => <span key={order.id}>{order.orderNo} · {order.passengerName}</span>)}</div>}</section>
    <section className="fleet-reply-source"><label>车队原始回复（完整保留）<textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="从微信或 WhatsApp 粘贴英文/泰语车队回复；一段文字可包含多笔订单。" /></label><label className="vehicle-upload">添加车辆图片<input type="file" accept="image/*" multiple onChange={(event) => void selectImages(event.currentTarget.files)} /></label>{images.length > 0 && <div className="reply-image-list">{images.map((image) => <img src={image.dataUrl} alt={image.filename} key={image.dataUrl} />)}</div>}<button className="assist-action" type="button" onClick={saveAndAnalyze} disabled={working || !context}>{working ? "正在处理…" : "保存原文并 AI 翻译并识别"}</button></section>
    {notice && <p className={`inline-notice ${notice.tone}`}>{notice.text}</p>}
    {result && <section className="fleet-reply-results"><div className="translation-block"><h2>完整中文翻译</h2><pre>{result.translation_zh}</pre></div><h2>订单识别建议</h2>{result.records.map((record, index) => <article className="reply-candidate" key={`${record.source_index}-${index}`}><header><strong>资料 {record.source_index}</strong><span>{record.order_match.platform_order_number ? `候选订单：${record.order_match.platform_order_number}` : "待人工归属"} · {record.order_match.confidence}</span></header><p className="reply-evidence">归属依据：{record.order_match.evidence}</p><label className="reply-confirm"><input type="checkbox" checked={forms[index]?.selected ?? false} onChange={(event) => setForm(index, "selected", event.target.checked)} />我已核对，确认写入此笔订单</label><div className="driver-form"><label>对应订单<select value={forms[index]?.orderId ?? ""} onChange={(event) => setForm(index, "orderId", event.target.value)}><option value="">请选择订单</option>{context?.orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.passengerName}</option>)}</select></label><label>司机姓名<input value={forms[index]?.driverName ?? ""} onChange={(event) => setForm(index, "driverName", event.target.value)} /></label><label>司机电话<input value={forms[index]?.driverPhone ?? ""} onChange={(event) => setForm(index, "driverPhone", event.target.value)} /></label><label>车牌号<input value={forms[index]?.licensePlate ?? ""} onChange={(event) => setForm(index, "licensePlate", event.target.value)} /></label><label>具体车型<input value={forms[index]?.vehicleModel ?? ""} onChange={(event) => setForm(index, "vehicleModel", event.target.value)} /></label></div><p className="reply-evidence">车型依据：{record.vehicle_model.evidence || record.vehicle_category.evidence}{record.needs_review ? `；待复核：${record.review_reasons.join("；")}` : ""}</p></article>)}{result.unmatched_items.length > 0 && <div className="unmatched-block"><h3>待人工归属</h3>{result.unmatched_items.map((item) => <p key={`${item.source_type}-${item.source_id}`}>{item.source_type}：{item.reason}</p>)}</div>}<button type="button" className="confirm-action" onClick={confirm} disabled={working}>{working ? "正在确认…" : `确认写入 ${forms.filter((item) => item.selected).length} 笔订单`}</button></section>}
  </main>;
}
