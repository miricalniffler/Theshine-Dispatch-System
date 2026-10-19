"use client";

import { useEffect, useState } from "react";

type Tab = "drivers" | "vehicles";

export default function ArchivesPage() {
  const [tab, setTab] = useState<Tab>("drivers");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const load = async (nextTab = tab) => {
    const response = await fetch(`/api/archives/${nextTab}?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const json = await response.json();
    setRows(json.data || []);
  };
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "vehicles") setTab("vehicles");
  }, []);
  useEffect(() => { void load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json();
    setMessage(response.ok ? "档案已更新，历史订单关联未被改写。" : json.error?.message || "操作失败。");
    if (response.ok) void load();
  };
  async function addPhone(id: string) { const rawPhone = window.prompt("输入需要关联的泰国手机号："); if (!rawPhone) return; const response = await fetch(`/api/archives/drivers/${id}/phones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawPhone }) }); const json = await response.json(); setMessage(response.ok ? "手机号已关联。" : json.error?.message || "关联失败。"); if (response.ok) void load(); }
  async function merge(sourceProfileId: string) { const targetProfileId = window.prompt("输入要合并到的目标司机档案编号："); if (!targetProfileId) return; const response = await fetch("/api/archives/drivers/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceProfileId, targetProfileId }) }); const json = await response.json(); setMessage(response.ok ? "档案已合并；历史搭配与审计已保留。" : json.error?.message || "合并失败。"); if (response.ok) void load(); }
  function editDriver(row: any) { const displayName = window.prompt("司机显示姓名（无名氏可保留）：", row.displayName); if (!displayName) return; void update(`/api/archives/drivers/${row.id}`, { displayName, thaiName: window.prompt("泰文原名（可留空）：", row.thaiName || "") || null, confirmedEnglishName: window.prompt("确认英文姓名（可留空）：", row.confirmedEnglishName || "") || null }); }
  function editVehicle(row: any) { const rawLicensePlate = window.prompt("车牌（保留原始泰文）：", row.rawLicensePlate || row.normalizedPlate || ""); if (rawLicensePlate === null) return; const vehicleCategory = window.prompt("车辆类别：", row.vehicleCategory || ""); if (vehicleCategory === null) return; const vehicleModel = window.prompt("具体车型：", row.vehicleModel || ""); if (vehicleModel === null) return; void update(`/api/archives/vehicles/${row.id}`, { rawLicensePlate, vehicleCategory, vehicleModel, brand: window.prompt("品牌：", row.brand || "") || null }); }
  return <main className="workflow-page"><nav className="workflow-nav"><a href="/orders">订单工作台</a><a href="/fleets">车队管理</a><a className="active" href="/archives">司机与车辆库</a></nav><header className="workflow-header"><p className="workflow-kicker">司机与车辆储备库</p><h1>只记录新保存的司机和车辆资料</h1><p>系统不会回填旧订单。手机号仅用于寻找候选人；无名氏档案保持彼此独立。</p></header><section className="v3-card"><div className="v3-batch-actions"><button className={tab === "drivers" ? "v3-primary" : "v3-secondary"} onClick={() => setTab("drivers")}>司机库</button><button className={tab === "vehicles" ? "v3-primary" : "v3-secondary"} onClick={() => setTab("vehicles")}>车辆库</button><input aria-label="搜索档案" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "drivers" ? "姓名、手机号或档案编号" : "车牌或车型"}/><button className="v3-secondary" onClick={() => void load()}>搜索</button></div>{message && <p className="inline-notice success">{message}</p>}{tab === "drivers" ? <div className="v3-table-wrap"><table className="v3-orders-table"><thead><tr><th>司机</th><th>手机号</th><th>历史搭配 / 车辆</th><th>历史临时英文姓名</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.displayName}</b><small>{row.id}</small></td><td>{row.phones.map((phone: any) => phone.normalizedPhone).join("、") || "未提供"}</td><td>已安排 {row.counts.arranged} · 已完成 {row.counts.completed} · 已取消 {row.counts.cancelled}<small>{row.assignments.map((item: any) => item.vehicleProfile?.rawLicensePlate || item.vehicleProfile?.normalizedPlate).filter(Boolean).join("、") || "未关联车辆"}</small></td><td>{row.temporaryNames.map((item: any) => `${item.generatedName}（${item.orderId.slice(-6)}）`).join("、") || "无"}</td><td><button className="v3-secondary" onClick={() => editDriver(row)}>编辑</button> <button className="v3-secondary" onClick={() => void addPhone(row.id)}>关联手机号</button> <button className="v3-secondary" onClick={() => void merge(row.id)}>合并档案</button></td></tr>)}{!rows.length && <tr><td colSpan={5}>暂无上线后建立的司机档案</td></tr>}</tbody></table></div> : <div className="v3-table-wrap"><table className="v3-orders-table"><thead><tr><th>车牌</th><th>品牌 / 车型</th><th>来源</th><th>历史司机与订单</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.rawLicensePlate || row.normalizedPlate || "未提供"}</td><td>{[row.brand, row.vehicleModel].filter(Boolean).join(" · ") || "待核对"}</td><td>{row.dataSource}</td><td>{row.assignments.map((item: any) => `${item.order.platformOrderNumber} · ${item.driverProfile?.displayName || "无名氏"}`).join("；") || "暂无"}</td><td><button className="v3-secondary" onClick={() => editVehicle(row)}>编辑</button></td></tr>)}{!rows.length && <tr><td colSpan={5}>暂无上线后建立的车辆档案</td></tr>}</tbody></table></div>}</section></main>;
}
