"use client";

import { useEffect, useMemo, useState } from "react";

type PreviewItem = { orderId: string; orderNo: string; eligible: boolean; reason: string | null; warnings: string[]; message: string | null; guide: { airportName: string; images: unknown[] } | null };

export function CustomerContactPreviewDialog({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [oneOffTexts, setOneOffTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/customer-notifications/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderIds }) })
      .then((response) => response.json()).then((payload) => {
        const next = payload.data?.items ?? [];
        setItems(next); setSelected(next.filter((item: PreviewItem) => item.eligible).map((item: PreviewItem) => item.orderId));
      }).catch(() => setNotice("无法生成预览，请关闭后重试。")).finally(() => setLoading(false));
  }, [orderIds]);
  const counts = useMemo(() => ({ ready: items.filter((item) => item.eligible).length, excluded: items.filter((item) => !item.eligible).length, warnings: items.filter((item) => item.warnings.length).length }), [items]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  async function prepare() {
    setSaving(true); setNotice("");
    const response = await fetch("/api/customer-notifications/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderIds: selected, oneOffTexts }) });
    const payload = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setNotice(payload.error?.message || "无法生成待发送记录。"); return; }
    setNotice(`已生成 ${payload.data?.prepared ?? 0} 笔内部待发送内容。它们尚未通过 WhatsApp 发给客人。`);
  }
  return <div className="customer-contact-overlay" role="presentation" onMouseDown={onClose}><section className="customer-contact-dialog" role="dialog" aria-modal="true" aria-label="批量联系客人" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><small>客户沟通</small><h2>批量联系客人</h2><p>这里只生成内部待发送内容和记录；当前不会向客人真实发送 WhatsApp。</p></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
    {loading ? <p className="customer-contact-loading">正在检查订单是否适合联系…</p> : <><div className="customer-contact-summary"><span>{items.length} 笔已选订单</span><b>{counts.ready} 笔可生成</b><span>{counts.excluded} 笔暂不可用</span>{counts.warnings > 0 && <span>{counts.warnings} 笔有机场指引提醒</span>}</div>
      <div className="customer-contact-list">{items.map((item) => <article key={item.orderId} className={!item.eligible ? "is-excluded" : ""}><header><label><input type="checkbox" checked={selected.includes(item.orderId)} disabled={!item.eligible} onChange={() => toggle(item.orderId)} /><strong>{item.orderNo}</strong></label><button type="button" onClick={() => setExpanded(expanded === item.orderId ? null : item.orderId)}>{expanded === item.orderId ? "收起预览" : "查看预览"}</button></header>{item.reason && <p className="customer-contact-reason">{item.reason}</p>}{item.warnings.map((warning) => <p key={warning} className="customer-contact-warning">⚠ {warning}</p>)}{expanded === item.orderId && item.message && <div className="customer-contact-message"><label>本次临时调整（只影响这一笔待发送内容）<textarea value={oneOffTexts[item.orderId] ?? item.message} onChange={(event) => setOneOffTexts((current) => ({ ...current, [item.orderId]: event.target.value }))} /></label>{item.guide && <small>已附：{item.guide.airportName} 的文字指引{item.guide.images.length ? `及 ${item.guide.images.length} 张图片引用` : ""}。</small>}</div>}</article>)}</div>
      {notice && <p className="customer-contact-notice">{notice}</p>}<footer><button type="button" className="v3-secondary" onClick={onClose}>关闭</button><button type="button" className="v3-primary" disabled={!selected.length || saving} onClick={() => void prepare()}>{saving ? "正在生成…" : `生成 ${selected.length} 笔待发送内容`}</button></footer></>}
  </section></div>;
}
