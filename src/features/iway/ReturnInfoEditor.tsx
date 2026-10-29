"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DriverDetails } from "./service";
import "./iway.css";

type Notice = { tone: "success" | "error"; text: string } | null;

const empty = (orderId: string): DriverDetails => ({
  orderId, rawReply: "", confirmedDriverName: null, rawDriverPhone: null,
  normalizedDriverPhone: null, confirmedVehicleModel: null,
  confirmedVehicleCategory: null, licensePlate: null, confirmedAt: null,
  driverProfileId: null, vehicleProfileId: null, driverNameSource: "MANUAL",
  iwayDriverName: null,
});

export function ReturnInfoEditor({ orderId }: { orderId: string }) {
  const [form, setForm] = useState<DriverDetails>(() => empty(orderId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/orders/${orderId}/driver-details`, { cache: "no-store" })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error?.message || "无法读取回传信息。");
        if (active) setForm({ ...empty(orderId), ...(payload.data || {}) });
      })
      .catch((error) => active && setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法读取回传信息。" }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [orderId]);

  const set = (key: keyof DriverDetails, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/driver-details`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawReply: form.rawReply,
          confirmedDriverName: form.confirmedDriverName,
          rawDriverPhone: form.rawDriverPhone,
          confirmedVehicleModel: form.confirmedVehicleModel,
          confirmedVehicleCategory: form.confirmedVehicleCategory,
          licensePlate: form.licensePlate,
          rawLicensePlate: form.licensePlate,
          changeType: "EDIT",
          skipArchiveHistory: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存失败。");
      setForm({ ...empty(orderId), ...payload.data.driver });
      setNotice(payload.data.valid
        ? { tone: "success", text: "回传信息已更新，不会标记为换车。" }
        : { tone: "error", text: `已保存，但还缺少：${payload.data.missingFields.join("、")}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "保存失败。" });
    } finally { setSaving(false); }
  }

  return <main className="workflow-page return-info-editor-page">
    <nav className="workflow-nav"><Link href="/orders">订单</Link><span className="active">修改回传信息</span></nav>
    <header className="workflow-header"><p className="workflow-kicker">订单回传</p><h1>修改回传信息</h1><p>只修改当前订单的司机和车辆资料。这里不需要粘贴车队回复，也不会进行 AI 识别或记录为换车。</p></header>
    {loading ? <p className="loading">正在读取当前回传信息…</p> : <section className="driver-card return-info-card">
      <div className="driver-form return-info-form">
        <label>司机姓名<input value={form.confirmedDriverName ?? ""} onChange={(event) => set("confirmedDriverName", event.target.value)} placeholder="例如 Don" /></label>
        <label>司机电话<input value={form.rawDriverPhone ?? ""} onChange={(event) => set("rawDriverPhone", event.target.value)} placeholder="例如 0622602845" /></label>
        <label>具体车型<input value={form.confirmedVehicleModel ?? ""} onChange={(event) => set("confirmedVehicleModel", event.target.value)} placeholder="例如 MITSUBISHI XPANDER" /></label>
        <label>完整车牌<input value={form.licensePlate ?? ""} onChange={(event) => set("licensePlate", event.target.value)} placeholder="例如 6ขท 1981" /></label>
      </div>
      <p className="return-info-help">车牌中的泰文会完整保留；没有泰文时则按原样保存。</p>
      {notice && <p className={`inline-notice ${notice.tone}`}>{notice.text}</p>}
      <footer><Link href="/orders" className="driver-return-link">返回订单</Link><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "正在保存…" : "保存回传信息"}</button></footer>
    </section>}
  </main>;
}
