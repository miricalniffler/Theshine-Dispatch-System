"use client";

import { useRef, useState } from "react";
import "./import-dialog.css";

type Fields = Record<string, string | number | null | undefined>;
const fieldLabels: Record<string, string> = {
  platformOrderNumber: "订单号", passengerName: "乘客姓名", passengerPhone: "乘客电话", pickupDateTime: "接客时间",
  pickupAddress: "接人地址", dropoffAddress: "送人地址", platformVehicleType: "平台车型", flightNumber: "航班号",
  adults: "成人数量", children: "儿童数量", luggage: "行李数量", meetGreetLine: "举牌信息", otherNotes: "其他备注",
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(source);
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("无法处理图片。")); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("无法读取图片。")); };
    image.src = source;
  });
}

export function ManualOrderImport() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [fields, setFields] = useState<Fields | null>(null);
  const [source, setSource] = useState<{ type: string; format: string; verified: boolean } | null>(null);
  const [duplicates, setDuplicates] = useState<{ exact: unknown[] }>({ exact: [] });
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [working, setWorking] = useState<"scan" | "parse" | "save" | null>(null);

  async function chooseImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) { setNotice({ tone: "error", text: "请选择或粘贴订单截图。" }); return; }
    try { setNotice(null); setFields(null); setSource(null); setImagePreview(await fileToDataUrl(file)); }
    catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法处理截图。" }); }
  }

  async function scanImage() {
    if (!imagePreview) return;
    setWorking("scan"); setNotice(null);
    try {
      const response = await fetch("/api/orders/import/scan-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl: imagePreview }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "截图识别失败。");
      setText(payload.data.text || "");
      setNotice({ tone: "success", text: "截图已转写。请快速核对文字，再识别订单字段。" });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "截图识别失败。" }); }
    finally { setWorking(null); }
  }

  async function parseOrder() {
    setWorking("parse"); setNotice(null);
    try {
      const response = await fetch("/api/orders/import/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sourceType: "manual", confirmedSource: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "订单字段识别失败。");
      setFields(payload.data.fields); setSource(payload.data.source); setDuplicates(payload.data.duplicates || { exact: [] });
      setNotice({ tone: "success", text: "字段已按网站规则整理。请核对后保存。" });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "订单字段识别失败。" }); }
    finally { setWorking(null); }
  }

  async function saveOrder() {
    if (!fields || !source) return;
    setWorking("save"); setNotice(null);
    try {
      const response = await fetch("/api/orders/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, source, rawText: text }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存订单失败。");
      setNotice({ tone: "success", text: `${payload.data.message} 你现在可以回到订单工作台继续派单。` });
      setFields(null); setSource(null); setImagePreview(""); setText("");
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "保存订单失败。" }); }
    finally { setWorking(null); }
  }

  return <main className="import-page"><section className="import-dialog manual-order-import">
    <header><div><p>手动录入订单</p><h2>粘贴文字或识别订单截图</h2><span>飞书暂不可用时，也可以直接把订单录入工作台。</span></div></header>
    <ol className="import-steps"><li className="active">1. 提供订单</li><li className={fields ? "active" : ""}>2. 核对字段</li><li>3. 保存订单</li></ol>
    {notice && <p className={`import-note ${notice.tone}`}>{notice.text}</p>}
    {!fields && <section className="import-source">
      <label>订单原文<textarea value={text} autoCapitalize="none" onChange={(event) => setText(event.target.value)} onPaste={(event) => { const pasted = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/")); if (pasted) { event.preventDefault(); void chooseImage(pasted); } }} placeholder="直接粘贴整封 i’way / esforty 订单文字；也可以在此处粘贴订单截图。" /></label>
      <div className="manual-image-actions"><button type="button" className="v3-secondary" onClick={() => fileInput.current?.click()}>上传订单截图</button><input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event.currentTarget.files?.[0])}/>{imagePreview && <button type="button" className="v3-primary" onClick={scanImage} disabled={working !== null}>{working === "scan" ? "正在识别截图…" : "识别这张订单截图"}</button>}</div>
      {imagePreview && <div className="manual-image-preview"><img src={imagePreview} alt="待识别的订单截图"/><button type="button" onClick={() => setImagePreview("")}>删除截图</button></div>}
      <p>截图只用于本次文字转写，不会作为订单资料保存。AI 不会补猜看不清的信息。</p>
      <footer><a className="v3-secondary" href="/orders">取消并返回工作台</a><button className="v3-primary" type="button" onClick={parseOrder} disabled={working !== null || !text.trim()}>{working === "parse" ? "正在整理字段…" : "识别订单字段"}</button></footer>
    </section>}
    {fields && <section className="import-review"><div><h3>核对订单字段</h3>{Object.entries(fields).filter(([key]) => key !== "cityDetection").map(([key, value]) => key === "city" ? <label key={key}>服务城市<select value={String(value ?? "")} onChange={(event) => setFields((current) => ({ ...current!, city: event.target.value }))}><option value="">请选择服务城市</option><option value="曼谷">曼谷</option><option value="苏梅">苏梅</option></select></label> : <label key={key}>{fieldLabels[key] || key}<input value={String(value ?? "")} onChange={(event) => setFields((current) => ({ ...current!, [key]: event.target.value }))}/></label>)}</div><div><h3>订单原文</h3><pre>{text}</pre><p>截图识别后仍由网站规则提取字段；你可以直接改正任何一项。</p></div><footer><button className="v3-secondary" type="button" onClick={() => { setFields(null); setSource(null); }}>返回修改</button><button className="v3-primary" type="button" onClick={saveOrder} disabled={working !== null || duplicates.exact.length > 0}>{duplicates.exact.length ? "订单号已存在" : working === "save" ? "正在保存…" : "确认并保存订单"}</button></footer></section>}
  </section></main>;
}
