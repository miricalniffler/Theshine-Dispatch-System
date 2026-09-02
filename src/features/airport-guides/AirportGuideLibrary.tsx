"use client";

import { useEffect, useMemo, useState } from "react";
import type { AirportGuideInput, AirportGuideView } from "./types";

const blankGuide = (): AirportGuideInput => ({ airportName: "", iataCode: "", terminal: "", guideText: "", isActive: true, aliases: [], addressKeywords: [] });

function commaList(value: string) { return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean); }

function guideToInput(guide: AirportGuideView): AirportGuideInput {
  return { airportName: guide.airportName, iataCode: guide.iataCode || "", terminal: guide.terminal || "", guideText: guide.guideText, isActive: guide.isActive, aliases: guide.aliases, addressKeywords: guide.addressKeywords };
}

export function AirportGuideLibrary() {
  const [guides, setGuides] = useState<AirportGuideView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<AirportGuideInput>(blankGuide);
  const [aliasText, setAliasText] = useState("");
  const [addressKeywordText, setAddressKeywordText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("正在读取机场指引库…");
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(editingId);

  const activeCount = useMemo(() => guides.filter((guide) => guide.isActive).length, [guides]);
  async function refresh() {
    const response = await fetch("/api/airport-guides", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error?.message || "读取机场指引失败。"); return; }
    setGuides(payload.data.guides);
    setNotice(`共 ${payload.data.guides.length} 个版本，其中 ${payload.data.guides.filter((guide: AirportGuideView) => guide.isActive).length} 个有效。`);
  }
  useEffect(() => { void refresh(); }, []);

  function startCreate(seed?: AirportGuideView) {
    const next = seed ? guideToInput(seed) : blankGuide();
    setEditingId(null); setEditorOpen(true); setForm({ ...next, isActive: true }); setAliasText(next.aliases.join("\n")); setAddressKeywordText(next.addressKeywords.join("\n")); setFiles([]); setNotice(seed ? "正在以该版本为基础新建指引；保存后旧的相同匹配条件版本会保留为历史版本。" : "填写后保存。图片会在文字指引保存后上传。 ");
  }
  function startEdit(guide: AirportGuideView) {
    const next = guideToInput(guide);
    setEditingId(guide.id); setEditorOpen(true); setForm(next); setAliasText(next.aliases.join("\n")); setAddressKeywordText(next.addressKeywords.join("\n")); setFiles([]); setNotice(`正在编辑 ${guide.airportName}。如要保留当前文案为历史版本，请使用“新建版本”。`);
  }
  function cancelEdit() { setEditingId(null); setEditorOpen(false); setForm(blankGuide()); setAliasText(""); setAddressKeywordText(""); setFiles([]); setNotice("已取消编辑。"); }
  function change<K extends keyof AirportGuideInput>(field: K, value: AirportGuideInput[K]) { setForm((current) => ({ ...current, [field]: value })); }

  async function save() {
    const input = { ...form, aliases: commaList(aliasText), addressKeywords: commaList(addressKeywordText) };
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/airport-guides/${editingId}` : "/api/airport-guides", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存失败。");
      const guide = payload.data.guide as AirportGuideView;
      if (files.length) {
        const imageData = new FormData(); files.forEach((file) => imageData.append("images", file));
        const upload = await fetch(`/api/airport-guides/${guide.id}/images`, { method: "POST", body: imageData });
        const uploadPayload = await upload.json();
        if (!upload.ok) setNotice(`文字指引已保存，但图片没有上传：${uploadPayload.error?.message || "请检查存储配置。"}`);
        else setNotice("机场指引和图片已保存。 ");
      } else setNotice("机场指引已保存。 ");
      setEditingId(null); setEditorOpen(false); setForm(blankGuide()); setAliasText(""); setAddressKeywordText(""); setFiles([]); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败。"); }
    finally { setSaving(false); }
  }

  async function toggleGuide(guide: AirportGuideView) {
    setSaving(true);
    try {
      const response = await fetch(`/api/airport-guides/${guide.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...guideToInput(guide), isActive: !guide.isActive }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "更新失败。");
      setNotice(`${guide.airportName} 已${guide.isActive ? "停用" : "启用"}。`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "更新失败。"); }
    finally { setSaving(false); }
  }

  async function deleteImage(guideId: string, imageId: string) {
    if (!window.confirm("确认删除这张机场指引图片吗？")) return;
    const response = await fetch(`/api/airport-guides/${guideId}/images/${imageId}`, { method: "DELETE" });
    const payload = await response.json();
    setNotice(response.ok ? "图片已删除。" : payload.error?.message || "删除图片失败。");
    if (response.ok) await refresh();
  }

  return <main className="airport-guide-page">
    <header className="airport-guide-header"><div><p>机场指引库</p><h1>机场接机指引</h1><span>只用 IATA、别名和地址关键词做确定性识别；不会调用 AI 猜机场。</span></div><button type="button" className="airport-primary" onClick={() => startCreate()}>新建机场指引</button></header>
    <p className="airport-guide-notice" role="status">{notice}</p>

    {editorOpen && <section className="airport-guide-editor" aria-label={isEditing ? "编辑机场指引" : "新建机场指引"}>
      <header><div><h2>{isEditing ? "编辑机场指引" : "新建机场指引"}</h2><p>相同 IATA / 航站楼匹配条件只会保留一个有效版本；创建新版本会自动停用旧版本，但不会删除历史。</p></div><button type="button" className="airport-text-button" onClick={cancelEdit}>取消</button></header>
      <div className="airport-guide-form-grid">
        <label>机场名称<input value={form.airportName} onChange={(event) => change("airportName", event.target.value)} placeholder="例如 Suvarnabhumi Airport" /></label>
        <label>IATA（可选）<input value={form.iataCode || ""} onChange={(event) => change("iataCode", event.target.value.toUpperCase())} maxLength={3} placeholder="BKK" /></label>
        <label>Terminal（可选）<input value={form.terminal || ""} onChange={(event) => change("terminal", event.target.value)} placeholder="Terminal 1" /></label>
        <label className="airport-active-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => change("isActive", event.target.checked)} />保存后立即启用</label>
        <label className="airport-span-2">别名 / 识别关键词<textarea value={aliasText} onChange={(event) => setAliasText(event.target.value)} placeholder={'每行一个，例如：\nSuvarnabhumi\nBangkok Airport'} /></label>
        <label className="airport-span-2">地址匹配关键词（可选）<textarea value={addressKeywordText} onChange={(event) => setAddressKeywordText(event.target.value)} placeholder={'每行一个，例如：\nSuvannabhumi International Airport\nAirport Terminal 1'} /></label>
        <label className="airport-span-2">接机指引文字<textarea value={form.guideText} onChange={(event) => change("guideText", event.target.value)} placeholder="客人将在 WhatsApp 中看到的接机指引文字" /></label>
        <label className="airport-span-2">指引图片（可多选）<input type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.currentTarget.files || []))} /><small>{files.length ? `待上传 ${files.length} 张图片。` : "保存文字指引后上传。未配置 Supabase Storage 时会给出明确提示，不会把图片写入数据库。"}</small></label>
      </div>
      <div className="airport-editor-actions"><button type="button" className="airport-primary" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存机场指引"}</button><button type="button" className="airport-secondary" onClick={cancelEdit}>取消</button></div>
    </section>}

    <section className="airport-guide-list" aria-label="机场指引列表"><header><h2>现有指引</h2><span>有效 {activeCount} 个 · 历史版本也会保留</span></header>{guides.length ? <div className="airport-guide-cards">{guides.map((guide) => <article key={guide.id} className={`airport-guide-card${guide.isActive ? "" : " inactive"}`}><header><div><span className={guide.isActive ? "airport-status-active" : "airport-status-inactive"}>{guide.isActive ? "有效" : "已停用"}</span><h3>{guide.airportName}</h3><p>{guide.iataCode || "未填写 IATA"}{guide.terminal ? ` · ${guide.terminal}` : ""}</p></div><div className="airport-card-actions"><button type="button" onClick={() => startEdit(guide)}>编辑</button><button type="button" onClick={() => startCreate(guide)}>新建版本</button><button type="button" disabled={saving} onClick={() => void toggleGuide(guide)}>{guide.isActive ? "停用" : "启用"}</button></div></header><p className="airport-guide-text">{guide.guideText}</p><dl><div><dt>别名</dt><dd>{guide.aliases.join("、") || "—"}</dd></div><div><dt>地址关键词</dt><dd>{guide.addressKeywords.join("、") || "—"}</dd></div></dl>{guide.images.length > 0 && <div className="airport-images">{guide.images.map((image) => <figure key={image.id}>{image.publicUrl ? <img src={image.publicUrl} alt={image.originalFilename || `${guide.airportName} 指引图片`} /> : <div className="airport-image-metadata">{image.originalFilename || "已保存图片"}</div>}<figcaption>{image.originalFilename || "指引图片"}<button type="button" onClick={() => void deleteImage(guide.id, image.id)}>删除</button></figcaption></figure>)}</div>}<footer>更新于 {new Date(guide.updatedAt).toLocaleString("zh-CN")}</footer></article>)}</div> : <div className="airport-empty">还没有机场指引。新建后即可为后续客户通知提供确定性机场识别资料。</div>}</section>
  </main>;
}
