"use client";

import { useEffect, useState } from "react";
import "@/features/iway/iway.css";

type CandidateOrder = { id: string; orderNo: string; passengerName: string; pickup: string; route: string; city: string; fleetName: string };
type ReplyRecord = { source_index: number; order_match: { platform_order_number: string | null; confidence: string; evidence: string }; driver_name: { value: string | null; evidence: string }; driver_phone: { value: string | null; evidence: string }; license_plate: { value: string | null; evidence: string }; vehicle_category: { value: string | null; evidence: string }; vehicle_model: { value: string | null; evidence: string }; image_source_index: number | null; needs_review: boolean; review_reasons: string[] };
type Result = { records: ReplyRecord[]; unmatched_items: { source_type: string; source_id: string; reason: string }[]; recognition?: { provider: "GLM" | "QWEN" | "RULES"; label: string; note: string } };
type Editable = { orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleCategory: string; vehicleModel: string };
type ReturnWorkItem = { order: CandidateOrder & { serviceDate: string; pickupTime: string; status: string }; driver: { confirmedDriverName: string | null; normalizedDriverPhone: string | null; confirmedVehicleCategory: string | null; confirmedVehicleModel: string | null; licensePlate: string | null } | null };

function bangkokTomorrow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function fileToDataUrl(file: File) {
  return new Promise<{ dataUrl: string; mimeType: string }>((resolve, reject) => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(source);
      // 车辆与车牌仍清晰可见，同时大幅缩短视觉识别的上传和处理时间。
      const longestSide = 1600;
      const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("无法处理图片。")); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.82), mimeType: "image/jpeg" });
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("无法读取图片。")); };
    image.src = source;
  });
}

async function copyTextWithFallback(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // iPhone Safari may deny clipboard access outside a trusted context.
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

export function FleetReplyWorkspace() {
  const [rawText, setRawText] = useState("");
  const [images, setImages] = useState<{ dataUrl: string; filename: string; mimeType: string }[]>([]);
  const [fleetProfile, setFleetProfile] = useState<"AUTO" | "BANGKOK" | "SAMUI">("AUTO");
  const [serviceDate, setServiceDate] = useState(bangkokTomorrow);
  const [availableDates, setAvailableDates] = useState<string[]>([bangkokTomorrow()]);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [orders, setOrders] = useState<CandidateOrder[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [forms, setForms] = useState<Editable[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [iwayText, setIwayText] = useState("");
  const [returnOrderIds, setReturnOrderIds] = useState<string[]>([]);
  const [returnBatchId, setReturnBatchId] = useState<string | null>(null);
  const [markedReturned, setMarkedReturned] = useState(false);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [returnItems, setReturnItems] = useState<ReturnWorkItem[]>([]);

  useEffect(() => {
    fetch("/api/fleet-replies/dates").then((response) => response.json()).then((payload) => {
      const dates = payload.data?.dates as string[] | undefined;
      if (dates?.length) setAvailableDates(dates);
      if (payload.data?.defaultDate) setServiceDate(payload.data.defaultDate);
    });
  }, []);

  const loadReturnItems = () => fetch("/api/driver-details").then((response) => response.json()).then((payload) => setReturnItems(payload.data || []));
  useEffect(() => { void loadReturnItems(); }, []);

  async function selectImages(files: Iterable<File> | null | undefined) {
    if (!files) return;
    const next = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(async (file) => {
      const optimized = await fileToDataUrl(file);
      return { ...optimized, filename: file.name || "粘贴的车辆图片" };
    }));
    setImages((current) => [...current, ...next]);
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, position) => position !== index));
  }

  function formsFromResult(value: Result, candidateOrders: CandidateOrder[]) {
    return value.records.map((record) => {
      const matched = candidateOrders.find((order) => order.orderNo.replace(/\D/g, "") === (record.order_match.platform_order_number ?? "").replace(/\D/g, ""));
      return { orderId: matched?.id ?? "", driverName: record.driver_name.value ?? "", driverPhone: record.driver_phone.value ?? "", licensePlate: record.license_plate.value ?? "", vehicleCategory: record.vehicle_category.value ?? "", vehicleModel: record.vehicle_model.value ?? "" };
    });
  }

  function missingFields(form: Editable) {
    return [!form.orderId ? "对应订单" : "", !form.driverName.trim() ? "司机姓名" : "", !form.driverPhone.trim() ? "司机电话" : "", !form.vehicleModel.trim() ? "车型" : "", !form.licensePlate.trim() ? "车牌" : ""].filter(Boolean);
  }
  function isComplete(form: Editable) { return missingFields(form).length === 0; }
  function missingReturnFields(item: ReturnWorkItem) {
    const driver = item.driver;
    return [!driver?.confirmedDriverName ? "司机姓名" : "", !driver?.normalizedDriverPhone ? "司机电话" : "", !driver?.confirmedVehicleModel ? "车型" : "", !driver?.licensePlate ? "车牌" : ""].filter(Boolean);
  }
  const datedReturnItems = returnItems.filter((item) => item.order.serviceDate === serviceDate && ["DISPATCHED", "DRIVER_CONFIRMED", "RETURNED"].includes(item.order.status));
  useEffect(() => {
    setReturnOrderIds(datedReturnItems.filter((item) => missingReturnFields(item).length === 0).map((item) => item.order.id));
    setIwayText(""); setReturnBatchId(null); setMarkedReturned(false);
  // The selection intentionally resets only when the displayed service date/data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceDate, returnItems]);

  async function saveAndGenerate(currentReplyId: string, records: Editable[], currentExtractionId: string | null) {
    const errors: string[] = [];
    const savedOrderIds: string[] = [];
    // 每笔订单互不依赖；并行保存可以避免 5 笔资料就把等待时间放大为 5 倍。
    const confirmations = await Promise.all(records.filter((item) => item.orderId).map(async (record) => {
      const response = await fetch(`/api/fleet-replies/${currentReplyId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractionId: currentExtractionId, records: [record] }) });
      return { record, response, payload: await response.json() };
    }));
    for (const { record, response, payload } of confirmations) {
      if (response.ok && payload.data?.valid) savedOrderIds.push(record.orderId);
      else errors.push(payload.data?.errors?.map((item: { message: string }) => item.message).join("；") || payload.error?.message || "这笔资料未能保存。");
    }
    if (!savedOrderIds.length) {
      setIwayText("");
      setReturnOrderIds([]);
      setUnresolved(errors.length ? errors : ["没有可自动匹配的订单，请补充订单号后修改资料。"]);
      return { savedOrderIds, errors: errors.length ? errors : ["没有可自动匹配的订单，请补充订单号后修改资料。"] };
    }
    const previewResponse = await fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: savedOrderIds }) });
    const preview = await previewResponse.json();
    if (preview.data?.valid && preview.data?.text) setIwayText(preview.data.text);
    else errors.push(...(preview.data?.errors || ["已保存资料，但暂时无法生成回传内容。"]));
    setUnresolved([...new Set(errors)]);
    setReturnOrderIds(savedOrderIds);
    setReturnBatchId(null);
    setMarkedReturned(false);
    void loadReturnItems();
    setNotice({ tone: errors.length ? "error" : "success", text: errors.length ? `已生成 ${savedOrderIds.length} 笔可回传内容；另有资料需要修改。` : `已自动保存并生成 ${savedOrderIds.length} 笔 i’way 回传内容。` });
    return { savedOrderIds, errors };
  }

  async function copyIwayReturn() {
    if (!returnOrderIds.length) return;
    const response = await fetch("/api/iway-return-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: returnOrderIds }) });
    const payload = await response.json();
    if (!response.ok || !payload.data?.valid) { setNotice({ tone: "error", text: payload.data?.errors?.join("；") || payload.error?.message || "无法复制回传内容。" }); return; }
    const copied = await copyTextWithFallback(payload.data.text);
    if (!copied) {
      setNotice({ tone: "error", text: "系统无法自动复制。请长按下方回传文本，选择“全选”后复制。" });
      return;
    }
    setReturnBatchId(payload.data.batchId);
    setNotice({ tone: "success", text: "回传内容已复制，可直接粘贴至 i’way。是否标记为已回传由你自行决定。" });
  }

  async function confirmIwayReturn() {
    if (!returnOrderIds.length || markedReturned) return;
    setWorking(true);
    try {
      let batchId = returnBatchId;
      if (!batchId) {
        const copyResponse = await fetch("/api/iway-return-batches/copy-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: returnOrderIds }) });
        const copyPayload = await copyResponse.json();
        if (!copyResponse.ok || !copyPayload.data?.batchId) throw new Error(copyPayload.error?.message || "无法记录回传内容。");
        batchId = copyPayload.data.batchId;
      }
      const response = await fetch("/api/iway-return-batches/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "无法确认回传。");
      setMarkedReturned(true);
      setNotice({ tone: "success", text: "已记录为 i’way 回传完成。你可以继续处理其他车队回复。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "确认回传失败。" });
    } finally { setWorking(false); }
  }

  async function saveAndAnalyze() {
    setWorking(true); setNotice(null); setResult(null); setForms([]); setIwayText(""); setUnresolved([]); setShowEditor(false);
    try {
      const create = await fetch("/api/fleet-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawText, images, fleetProfile, serviceDate }) });
      const created = await create.json();
      if (!create.ok) throw new Error(created.error?.message || "无法保存原始回复。");
      setReplyId(created.data.id);
      const response = await fetch(`/api/fleet-replies/${created.data.id}/analyze`, { method: "POST" });
      const analysed = await response.json();
      if (analysed.data?.status !== "SUCCEEDED") throw new Error(analysed.data?.message || "AI 识别未完成；原始资料已保存。");
      const candidateOrders = analysed.data.orders as CandidateOrder[];
      setExtractionId(analysed.data.extractionId);
      setOrders(candidateOrders);
      setResult(analysed.data.result);
      const nextForms = formsFromResult(analysed.data.result, candidateOrders);
      setForms(nextForms);
      // 已准确匹配订单且资料齐全的回复，直接保存并生成回传文本。运营人员
      // 随后仍可点击“修改回传资料”更正；不完整或匹配不确定的结果才需要人工处理。
      const ready = nextForms.filter((form, index) => {
        const record = analysed.data.result.records[index] as ReplyRecord | undefined;
        return Boolean(record && record.order_match.confidence === "high" && isComplete(form));
      });
      const autoSave = ready.length ? await saveAndGenerate(created.data.id, ready, analysed.data.extractionId) : null;
      const needsEdit = ready.length !== nextForms.length || Boolean(autoSave?.errors.length);
      setShowEditor(needsEdit);
      if (!ready.length) setNotice({ tone: "error", text: "识别结果尚不完整或订单匹配不够确定，请补充后再保存。" });
      else if (needsEdit && !autoSave?.errors.length) setNotice({ tone: "success", text: `已自动保存 ${ready.length} 笔完整资料并生成 i’way 回传；其余资料请补充后再保存。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "分析失败。" });
    } finally {
      setWorking(false);
    }
  }

  function setForm(index: number, key: keyof Editable, value: string) {
    setForms((current) => current.map((form, position) => position === index ? { ...form, [key]: value } : form));
  }

  function toggleReturnOrder(orderId: string) {
    setReturnOrderIds((current) => current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]);
    setIwayText("");
    setReturnBatchId(null);
    setMarkedReturned(false);
  }

  async function generateSelectedReturn() {
    if (!returnOrderIds.length) return;
    setWorking(true);
    try {
      const response = await fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: returnOrderIds }) });
      const payload = await response.json();
      if (!response.ok || !payload.data?.valid || !payload.data?.text) throw new Error(payload.data?.errors?.join("；") || payload.error?.message || "暂时无法生成回传内容。");
      setIwayText(payload.data.text);
      setNotice({ tone: "success", text: `已生成 ${returnOrderIds.length} 笔 i’way 回传内容。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "暂时无法生成回传内容。" });
    } finally { setWorking(false); }
  }

  async function saveAssigned() {
    if (!replyId) return;
    if (!forms.some((form) => form.orderId)) { setNotice({ tone: "error", text: "请先选择对应订单，或补充订单号。" }); return; }
    setWorking(true);
    await saveAndGenerate(replyId, forms, extractionId);
    setWorking(false);
  }

  function cancelEditing() {
    if (result) setForms(formsFromResult(result, orders));
    setShowEditor(false);
    setNotice(null);
  }

  return <main className="workflow-page fleet-reply-page">
    <nav className="workflow-nav"><a href="/orders">订单</a><a className="active" href="/driver-details">车队回传</a></nav>
    <header className="workflow-header"><p className="workflow-kicker">车队回传</p><h1>车队回复与 i’way 回传</h1><p>识别、核对和 i’way 文本生成在同一页完成。订单号、电话、车牌和回传格式由网站规则处理；AI 可在启用后辅助识别泰文聊天截图、姓名转写和车辆图片，所有结果都可修改后再保存。</p></header>
    <section className="fleet-reply-source">
      <label>车队原始回复（完整保留）<textarea value={rawText} autoCapitalize="none" onChange={(event) => setRawText(event.target.value)} onPaste={(event) => { const pastedImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (pastedImages.length) void selectImages(pastedImages); }} placeholder="从微信或 WhatsApp 粘贴英文/泰语车队回复；文字和车辆截图可一起粘贴。" /></label>
      <label>匹配订单日期<select value={serviceDate} onChange={(event) => setServiceDate(event.target.value)}>{availableDates.map((date) => <option key={date} value={date}>{date === bangkokTomorrow() ? `明天 · ${date}` : date}</option>)}</select></label>
      <label>车队规则<select value={fleetProfile} onChange={(event) => setFleetProfile(event.target.value as "AUTO" | "BANGKOK" | "SAMUI")}><option value="AUTO">自动判断（判断不出时提示）</option><option value="BANGKOK">曼谷车队</option><option value="SAMUI">苏梅车队</option></select></label>
      <label className="vehicle-upload">添加车辆照片或车队聊天截图<input type="file" accept="image/*" multiple onChange={(event) => void selectImages(event.currentTarget.files)} /></label>
      {images.length > 0 && <div className="reply-image-list" aria-label="已添加车辆图片">{images.map((image, index) => <div className="reply-image-item" key={image.dataUrl}><img src={image.dataUrl} alt={image.filename} /><button type="button" className="remove-reply-image" onClick={() => removeImage(index)} aria-label={`删除车辆图片 ${index + 1}`}>删除</button></div>)}</div>}
      <button className="assist-action" type="button" onClick={saveAndAnalyze} disabled={working || (!rawText.trim() && !images.length)}>{working ? "正在处理…" : `整理并匹配 ${serviceDate === bangkokTomorrow() ? "明日" : serviceDate} 订单`}</button>
    </section>
    {notice && <p className={`inline-notice ${notice.tone}`}>{notice.text}</p>}
    <section className="fleet-reply-results iway-return-queue"><h2>待回传 i’way</h2><p>当前日期：{serviceDate}。司机资料完整的订单已默认勾选；不完整订单会显示缺失项且不会勾选。</p>{datedReturnItems.length ? datedReturnItems.map((item) => { const missing = missingReturnFields(item); const complete = missing.length === 0; return <article className="reply-candidate reply-result-summary" key={item.order.id}><header><strong>{item.order.orderNo}</strong><span className={complete ? "reply-complete" : "reply-incomplete"}>{complete ? "资料完整" : `缺${missing.join("、")}`}</span></header><div className="reply-result-fields"><span>司机：{item.driver?.confirmedDriverName || "—"}</span><span>电话：{item.driver?.normalizedDriverPhone || "—"}</span><span>车型：{item.driver?.confirmedVehicleModel || "—"}</span><span>车牌：{item.driver?.licensePlate || "—"}</span></div><label className="reply-return-select"><input type="checkbox" checked={returnOrderIds.includes(item.order.id)} disabled={!complete} onChange={() => toggleReturnOrder(item.order.id)} />加入 i’way 回传</label></article>; }) : <p className="preview-empty">当前日期没有可回传的订单。</p>}{iwayText ? <pre tabIndex={0}>{iwayText}</pre> : <p className="preview-empty">选择订单后可直接生成 i’way 标准文本。</p>}<div className="preview-actions"><button type="button" className="confirm-action" onClick={() => void generateSelectedReturn()} disabled={working || !returnOrderIds.length}>生成标准文本</button><button type="button" className="secondary-action" onClick={() => void copyIwayReturn()} disabled={working || !iwayText}>复制全部</button><button type="button" className="return-mark-action" onClick={() => void confirmIwayReturn()} disabled={working || !returnOrderIds.length || markedReturned}>{markedReturned ? "已标记为已回传" : "标记为已回传"}</button></div></section>
    {result && <section className="fleet-reply-results">
      <section className="fleet-reply-recognized"><h2>② 识别结果</h2><p>{result.recognition?.label || "规则降级"}{result.recognition?.note ? ` · ${result.recognition.note}` : ""}</p><p>资料完整的订单已默认勾选进入 i’way 回传；缺少资料的订单不会被选中。</p>{result.records.map((record, index) => { const form = forms[index]; const missing = form ? missingFields(form) : ["资料"]; const complete = form ? isComplete(form) : false; const order = orders.find((item) => item.id === form?.orderId); return <article className="reply-candidate reply-result-summary" key={`${record.source_index}-${index}`}><header><strong>{order?.orderNo || record.order_match.platform_order_number || "未匹配订单"}</strong><span className={complete ? "reply-complete" : "reply-incomplete"}>{complete ? "资料完整" : `缺${missing.join("、")}`}</span></header><div className="reply-result-fields"><span>司机：{form?.driverName || "—"}</span><span>电话：{form?.driverPhone || "—"}</span><span>车型：{form?.vehicleModel || "—"}</span><span>车牌：{form?.licensePlate || "—"}</span></div>{complete && form?.orderId && <label className="reply-return-select"><input type="checkbox" checked={returnOrderIds.includes(form.orderId)} onChange={() => toggleReturnOrder(form.orderId)} />加入 i’way 回传</label>}</article>; })}</section>
      {unresolved.length > 0 && <div className="unmatched-block"><h3>有资料需要修改</h3>{unresolved.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}</div>}
      <button type="button" className="secondary-action" onClick={() => setShowEditor((current) => !current)}>{showEditor ? "收起修改资料" : "修改回传资料"}</button>
      {showEditor && <><h2>修改回传资料</h2>{result.records.map((record, index) => <article className="reply-candidate" key={`${record.source_index}-${index}`}>
        <header><strong>资料 {index + 1}</strong><span>{record.order_match.platform_order_number ? `自动匹配：${record.order_match.platform_order_number}` : "需要补订单号"} · {record.order_match.confidence}</span></header>
        <p className="reply-evidence">归属依据：{record.order_match.evidence || "原文信息不足，暂不能确定对应订单。"}</p>
        <div className="driver-form">
          <label>对应订单<select value={forms[index]?.orderId ?? ""} onChange={(event) => setForm(index, "orderId", event.target.value)}><option value="">AI 无法判断时，请在这里选择订单</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.passengerName} · {order.pickup}</option>)}</select></label>
          <label>司机姓名<input value={forms[index]?.driverName ?? ""} onChange={(event) => setForm(index, "driverName", event.target.value)} /></label>
          <label>司机电话<input value={forms[index]?.driverPhone ?? ""} onChange={(event) => setForm(index, "driverPhone", event.target.value)} /></label>
          <label>车牌号<input value={forms[index]?.licensePlate ?? ""} onChange={(event) => setForm(index, "licensePlate", event.target.value)} /></label>
          <label>车辆类别<input value={forms[index]?.vehicleCategory ?? ""} onChange={(event) => setForm(index, "vehicleCategory", event.target.value)} placeholder="例如 VAN" /></label>
          <label>具体车型<input value={forms[index]?.vehicleModel ?? ""} onChange={(event) => setForm(index, "vehicleModel", event.target.value)} /></label>
        </div>
        <p className="reply-evidence">车型来源：{record.vehicle_model.evidence || record.vehicle_category.evidence || "原文未提供"}{record.image_source_index ? `；关联车辆图片 ${record.image_source_index}` : ""}{record.needs_review ? `；${record.review_reasons.join("；")}` : ""}</p>
      </article>)}
      {result.unmatched_items.length > 0 && <div className="unmatched-block"><h3>待补充信息</h3>{result.unmatched_items.map((item) => <p key={`${item.source_type}-${item.source_id}`}>{item.reason || "AI 无法判断归属，请补充订单号。"}</p>)}</div>}
      <div className="preview-actions"><button type="button" className="confirm-action" onClick={saveAssigned} disabled={working}>{working ? "正在生成…" : "保存修改并重新生成回传"}</button><button type="button" className="secondary-action" onClick={cancelEditing} disabled={working}>取消修改</button></div></>}
    </section>}
  </main>;
}
