"use client";

import { useEffect, useState } from "react";
import type { RegionNotificationSettingView } from "./types";

export function RegionNotificationSettings() {
  const [settings, setSettings] = useState<RegionNotificationSettingView[]>([]);
  const [notice, setNotice] = useState("正在读取区域通知设置…");
  const [savingRegion, setSavingRegion] = useState<string | null>(null);
  async function refresh() {
    const response = await fetch("/api/notification-settings", { cache: "no-store" }); const payload = await response.json();
    if (!response.ok) { setNotice(payload.error?.message || "读取区域开关失败。"); return; }
    setSettings(payload.data.settings); setNotice("这里只配置后续客人 WhatsApp 通知资格；本阶段不会发送任何消息。");
  }
  useEffect(() => { void refresh(); }, []);
  async function update(item: RegionNotificationSettingView, enabled: boolean) {
    setSavingRegion(item.region);
    const response = await fetch("/api/notification-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region: item.region, customerWhatsAppEnabled: enabled }) }); const payload = await response.json();
    if (!response.ok) setNotice(payload.error?.message || "保存失败。");
    else { setSettings((current) => current.map((row) => row.region === item.region ? payload.data.setting : row)); setNotice(`${item.region} 已${enabled ? "开启" : "关闭"}后续客人 WhatsApp 通知资格。本阶段不会发送任何消息。`); }
    setSavingRegion(null);
  }
  return <section className="notification-settings" aria-label="客人 WhatsApp 通知"><header><div><p>客人 WhatsApp 通知</p><h2>按运营区域设置</h2></div><span>基础开关</span></header><p>{notice}</p><div className="notification-settings-list">{settings.map((item) => <label key={item.region}><span><strong>{item.region}</strong><small>{item.customerWhatsAppEnabled ? "后续功能可处理该区域" : "后续功能默认跳过该区域"}</small></span><input type="checkbox" role="switch" checked={item.customerWhatsAppEnabled} disabled={savingRegion === item.region} onChange={(event) => void update(item, event.target.checked)} /><b>{item.customerWhatsAppEnabled ? "ON" : "OFF"}</b></label>)}</div></section>;
}
