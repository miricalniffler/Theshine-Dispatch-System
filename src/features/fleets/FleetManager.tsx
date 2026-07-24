"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Fleet, FleetInput, fleetCities } from "./types";
import styles from "./fleet-manager.module.css";

const vehicleOptions = ["Sedan", "SUV", "Van", "Minibus", "Coach"];
const emptyForm: FleetInput = { name: "", city: "曼谷", chatNote: "", vehicleTypes: [], note: "", enabled: true };

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export default function FleetManager() {
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [city, setCity] = useState("全部城市");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FleetInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadFleets(selectedCity = city) {
    setLoading(true);
    const response = await fetch(`/api/fleets${selectedCity === "全部城市" ? "" : `?city=${encodeURIComponent(selectedCity)}`}`, { cache: "no-store" });
    const json = await response.json();
    setFleets(json.data ?? []);
    setLoading(false);
  }
  useEffect(() => { void loadFleets(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enabledCount = useMemo(() => fleets.filter((fleet) => fleet.enabled).length, [fleets]);
  function chooseCity(nextCity: string) { setCity(nextCity); void loadFleets(nextCity); }
  function beginEdit(fleet: Fleet) {
    setEditingId(fleet.id);
    setForm({ name: fleet.name, city: fleet.city, chatNote: fleet.chatNote, vehicleTypes: fleet.vehicleTypes, note: fleet.note, enabled: fleet.enabled });
    setError(""); setMessage("");
    document.getElementById("fleet-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function resetForm() { setEditingId(null); setForm(emptyForm); setError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const response = await fetch(editingId ? `/api/fleets/${editingId}` : "/api/fleets", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const json = await response.json();
    if (!response.ok) { setError(json.error?.fields?.[0]?.message ?? json.error?.message ?? "保存失败"); return; }
    setMessage(editingId ? "车队资料已更新" : "已新增车队"); resetForm(); await loadFleets();
  }
  function toggleVehicle(vehicle: string) {
    setForm((current) => ({ ...current, vehicleTypes: current.vehicleTypes.includes(vehicle) ? current.vehicleTypes.filter((item) => item !== vehicle) : [...current.vehicleTypes, vehicle] }));
  }
  async function toggleEnabled(fleet: Fleet) {
    const response = await fetch(`/api/fleets/${fleet.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fleet.name, city: fleet.city, chatNote: fleet.chatNote, vehicleTypes: fleet.vehicleTypes, note: fleet.note, enabled: !fleet.enabled }) });
    if (response.ok) { setMessage(`${fleet.name} 已${fleet.enabled ? "停用" : "启用"}`); await loadFleets(); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>FLEET DIRECTORY</p><h1>车队管理</h1><p>第一期固定使用曼谷车队和苏梅车队。订单会依城市自动分配，您只需维护联络和车型资料。</p></div><div className={styles.count}><strong>{enabledCount}</strong><span>当前可派单车队</span></div></header>
    <section className={styles.toolbar} aria-label="车队筛选"><span>服务城市</span>{["全部城市", ...fleetCities].map((item) => <button className={city === item ? styles.activeFilter : ""} onClick={() => chooseCity(item)} type="button" key={item}>{item}</button>)}</section>
    {message && <p className={styles.message} role="status">{message}</p>}
    <section className={styles.layout}>
      <div className={styles.tableCard}>
        <div className={styles.cardTitle}><h2>车队列表</h2><span>{loading ? "正在读取…" : `共 ${fleets.length} 个`}</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>车队</th><th>城市</th><th>群聊备注</th><th>可提供车型</th><th>状态</th><th>更新</th><th aria-label="操作" /></tr></thead><tbody>{!loading && fleets.map((fleet) => <tr key={fleet.id}><td><strong>{fleet.name}</strong>{fleet.note && <small>{fleet.note}</small>}</td><td><span className={styles.cityTag}>{fleet.city}</span></td><td>{fleet.chatNote || <span className={styles.muted}>未填写</span>}</td><td><div className={styles.vehicles}>{fleet.vehicleTypes.length ? fleet.vehicleTypes.map((vehicle) => <span key={vehicle}>{vehicle}</span>) : <span className={styles.muted}>未填写</span>}</div></td><td><button type="button" onClick={() => toggleEnabled(fleet)} className={fleet.enabled ? styles.enabled : styles.disabled}>{fleet.enabled ? "启用中" : "已停用"}</button></td><td>{formatTime(fleet.updatedAt)}</td><td><div className={styles.rowActions}><button className={styles.editButton} onClick={() => beginEdit(fleet)} type="button">编辑资料</button></div></td></tr>)}{!loading && fleets.length === 0 && <tr><td colSpan={7} className={styles.empty}>没有符合条件的车队</td></tr>}</tbody></table></div>
      </div>
      <form id="fleet-form" className={styles.formCard} onSubmit={submit}><div className={styles.cardTitle}><h2>{editingId ? "编辑车队资料" : "请选择上方车队后编辑"}</h2>{editingId && <button type="button" onClick={resetForm}>取消编辑</button>}</div>
        <label>车队名称<input value={form.name} placeholder="例如：曼谷车队" disabled /></label>
        <label>服务城市<select value={form.city} disabled>{fleetCities.map((item) => <option key={item}>{item}</option>)}</select><small>固定路由：订单会按城市自动分配至对应车队。</small></label>
        <label>群聊备注<input value={form.chatNote} onChange={(event) => setForm({ ...form, chatNote: event.target.value })} placeholder="例如：WhatsApp：Siam Dispatch" /></label>
        <fieldset><legend>可提供车型</legend><div className={styles.vehiclePicker}>{vehicleOptions.map((vehicle) => <label key={vehicle}><input type="checkbox" checked={form.vehicleTypes.includes(vehicle)} onChange={() => toggleVehicle(vehicle)} />{vehicle}</label>)}</div></fieldset>
        <label>备注<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="可填写合作约定或调度提醒" rows={3} /></label>
        <label className={styles.switch}><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span>允许派单给该车队</span></label>
        {error && <p className={styles.error}>{error}</p>}<button className={styles.saveButton} type="submit" disabled={!editingId}>{editingId ? "保存修改" : "请先选择车队"}</button>
      </form>
    </section>
  </main>;
}
