"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./archives.module.css";

type Tab = "drivers" | "vehicles";
type Phone = { normalizedPhone: string };
type Assignment = { order: { platformOrderNumber: string; serviceDate: string; status: string }; driverProfile?: { displayName: string } | null; vehicleProfile?: { rawLicensePlate: string | null; normalizedPlate: string | null; vehicleModel: string | null } | null };
type Driver = { id: string; displayName: string; thaiName: string | null; confirmedEnglishName: string | null; nameSource: string; phones: Phone[]; counts: { arranged: number; completed: number; cancelled: number }; assignments: Assignment[]; temporaryNames: { generatedName: string; orderId: string; createdAt: string }[] };
type Vehicle = { id: string; rawLicensePlate: string | null; normalizedPlate: string | null; displayLicensePlate?: string | null; displayPlateSource?: string; brand: string | null; vehicleCategory: string | null; vehicleModel: string | null; dataSource: string; isVerified: boolean; assignments: Assignment[] };

function driverStatus(row: Driver) { return row.displayName === "无名氏" ? "无名氏 / 临时姓名" : row.confirmedEnglishName ? "已确认英文姓名" : row.thaiName ? "保留泰文原名" : "待核对"; }
function plate(row: Vehicle) { return row.displayLicensePlate || row.rawLicensePlate || row.normalizedPlate || "未提供车牌"; }
function vehicleName(row: Vehicle) {
  const values = [row.brand, row.vehicleModel].filter((value): value is string => Boolean(value));
  return [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()].join(" · ") || "待核对具体车型";
}

export default function ArchivesPage() {
  const [tab, setTab] = useState<Tab>("drivers");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<(Driver | Vehicle)[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  async function load(nextTab = tab, search = query) {
    setLoading(true);
    try {
      const response = await fetch(`/api/archives/${nextTab}?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error?.message || "档案暂时无法读取");
      setRows(json.data || []);
      setSelectedId(null);
      setNotice("");
    } catch (error) {
      setRows([]);
      setSelectedId(null);
      setNotice(error instanceof Error ? error.message : "档案暂时无法读取，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (initial === "vehicles") setTab("vehicles");
  }, []);
  useEffect(() => { void load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) { setDraft({}); return; }
    if (tab === "drivers") { const row = selected as Driver; setDraft({ displayName: row.displayName, thaiName: row.thaiName || "", confirmedEnglishName: row.confirmedEnglishName || "" }); }
    else { const row = selected as Vehicle; setDraft({ rawLicensePlate: row.rawLicensePlate || row.normalizedPlate || "", brand: row.brand || "", vehicleCategory: row.vehicleCategory || "", vehicleModel: row.vehicleModel || "" }); }
  }, [selected, tab]);
  async function request(url: string, method: "PATCH" | "POST", body: unknown, success: string) {
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      setNotice(response.ok ? success : json.error?.message || "操作未完成，请核对后重试。");
      if (response.ok) await load();
    } catch {
      setNotice("操作暂时无法完成，请检查网络后重试。");
    }
  }
  function changeTab(next: Tab) { setTab(next); setQuery(""); setNotice(""); }
  const drivers = rows as Driver[];
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.kicker}>FLEET ARCHIVES</p><h1>司机与车辆储备库</h1><p>只记录上线后由运营人员保存或更新的资料。历史订单不会被批量导入或改写。</p></div><div className={styles.headerHint}>司机、车辆分别建档<br/>订单保留历史搭配</div></header>
    <section className={styles.toolbar}><div className={styles.tabs}><button className={tab === "drivers" ? styles.activeTab : ""} onClick={() => changeTab("drivers")}>司机库</button><button className={tab === "vehicles" ? styles.activeTab : ""} onClick={() => changeTab("vehicles")}>车辆库</button></div><div className={styles.search}><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder={tab === "drivers" ? "搜索姓名或手机号" : "搜索车牌或车型"} aria-label="搜索档案"/><button onClick={() => void load()}>搜索</button></div></section>
    {notice && <p className={styles.notice}>{notice}</p>}
    <section className={styles.layout}><div className={styles.listCard}><div className={styles.cardTitle}><div><h2>{tab === "drivers" ? "司机档案" : "车辆档案"}</h2><p>{loading ? "正在读取…" : `共 ${rows.length} 条符合条件的档案`}</p></div></div>{tab === "drivers" ? <div className={styles.list}>{drivers.map((row) => <button className={`${styles.row} ${selectedId === row.id ? styles.selected : ""}`} key={row.id} onClick={() => setSelectedId(row.id)}><span className={styles.avatar}>{row.displayName === "无名氏" ? "？" : row.displayName.slice(0, 1)}</span><span className={styles.rowMain}><strong>{row.displayName}</strong><small>{row.phones.map((item) => item.normalizedPhone).join(" · ") || "未登记手机号"}</small></span><span className={styles.rowMeta}><em>{driverStatus(row)}</em><small>安排 {row.counts.arranged} · 完成 {row.counts.completed}</small></span></button>)}{!loading && !rows.length && <p className={styles.empty}>暂无司机档案。保存新的司机资料后会自动建立档案。</p>}</div> : <div className={styles.list}>{(rows as Vehicle[]).map((row) => <button className={`${styles.row} ${selectedId === row.id ? styles.selected : ""}`} key={row.id} onClick={() => setSelectedId(row.id)}><span className={styles.plate}>{plate(row)}</span><span className={styles.rowMain}><strong>{vehicleName(row)}</strong><small>{row.vehicleCategory || "未填写车辆类别"}</small><small>{row.displayPlateSource || "车牌待核对"}</small></span><span className={styles.rowMeta}><em>{row.isVerified ? "已核实" : "待核对"}</em><small>{row.assignments.length} 笔历史搭配</small></span></button>)}{!loading && !rows.length && <p className={styles.empty}>暂无车辆档案。保存带车牌的司机资料后会自动建立档案。</p>}</div>}</div>
      <aside className={styles.detailCard}>{!selected ? <div className={styles.detailEmpty}><strong>选择一份档案</strong><p>可在这里查看历史搭配、编辑资料、关联手机号或合并司机档案。</p></div> : tab === "drivers" ? <DriverDetail row={selected as Driver} draft={draft} setDraft={setDraft} phone={phone} setPhone={setPhone} mergeTargetId={mergeTargetId} setMergeTargetId={setMergeTargetId} drivers={drivers} onSave={() => void request(`/api/archives/drivers/${selected.id}`, "PATCH", draft, "司机档案已更新；历史订单保持不变。")} onPhone={() => { if (phone.trim()) void request(`/api/archives/drivers/${selected.id}/phones`, "POST", { rawPhone: phone }, "手机号已关联到当前司机档案。"); }} onMerge={() => { if (mergeTargetId) void request("/api/archives/drivers/merge", "POST", { sourceProfileId: selected.id, targetProfileId: mergeTargetId }, "司机档案已合并；历史记录已保留。"); }} /> : <VehicleDetail row={selected as Vehicle} draft={draft} setDraft={setDraft} onSave={() => void request(`/api/archives/vehicles/${selected.id}`, "PATCH", draft, "车辆档案已更新；历史订单保持不变。")} />}</aside>
    </section>
  </main>;
}

function DriverDetail({ row, draft, setDraft, phone, setPhone, mergeTargetId, setMergeTargetId, drivers, onSave, onPhone, onMerge }: { row: Driver; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void; phone: string; setPhone: (value: string) => void; mergeTargetId: string; setMergeTargetId: (value: string) => void; drivers: Driver[]; onSave: () => void; onPhone: () => void; onMerge: () => void }) {
  return <><header className={styles.detailHeader}><p>司机档案</p><h2>{row.displayName}</h2><span>{driverStatus(row)}</span></header><div className={styles.form}><label>显示姓名<input value={draft.displayName || ""} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}/></label><label>泰文原名<input value={draft.thaiName || ""} onChange={(e) => setDraft({ ...draft, thaiName: e.target.value })}/></label><label>确认英文姓名<input value={draft.confirmedEnglishName || ""} onChange={(e) => setDraft({ ...draft, confirmedEnglishName: e.target.value })}/></label><button className={styles.primary} onClick={onSave}>保存司机资料</button></div><section className={styles.detailSection}><h3>关联手机号</h3><p>{row.phones.map((item) => item.normalizedPhone).join("、") || "暂未关联手机号"}</p><div className={styles.inlineForm}><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="新增泰国手机号"/><button onClick={onPhone}>关联</button></div></section><section className={styles.detailSection}><h3>历史搭配</h3>{row.assignments.length ? <ul>{row.assignments.map((item, index) => <li key={`${item.order.platformOrderNumber}-${index}`}><b>{item.order.platformOrderNumber}</b><span>{item.vehicleProfile?.rawLicensePlate || item.vehicleProfile?.normalizedPlate || "未提供车牌"} · {item.vehicleProfile?.vehicleModel || "待核对车型"}</span></li>)}</ul> : <p>暂无历史搭配。</p>}</section><section className={styles.detailSection}><h3>临时英文姓名</h3><p>{row.temporaryNames.length ? row.temporaryNames.map((item) => item.generatedName).join("、") : "无"}</p></section><section className={styles.merge}><h3>合并档案</h3><p>仅在确认同一司机后使用；手机号冲突会阻止合并。</p><select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}><option value="">选择要合并到的司机</option>{drivers.filter((item) => item.id !== row.id).map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.phones[0]?.normalizedPhone || "无手机号"}</option>)}</select><button disabled={!mergeTargetId} onClick={onMerge}>合并到所选档案</button></section></>;
}

function VehicleDetail({ row, draft, setDraft, onSave }: { row: Vehicle; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void; onSave: () => void }) {
  return <><header className={styles.detailHeader}><p>车辆档案</p><h2>{plate(row)}</h2><span>{row.isVerified ? "已核实资料" : "待人工核对"}</span></header><div className={styles.form}><label>原始车牌<input value={draft.rawLicensePlate || ""} onChange={(e) => setDraft({ ...draft, rawLicensePlate: e.target.value })}/><small>{row.displayPlateSource === "车队原始回复（仅展示）" ? "列表车牌来自原始车队回复；保存前请人工核对。" : "保留泰文原文；系统另行用于匹配。"}</small></label><label>车辆品牌<input value={draft.brand || ""} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}/></label><label>车辆类别<input value={draft.vehicleCategory || ""} onChange={(e) => setDraft({ ...draft, vehicleCategory: e.target.value })}/></label><label>具体车型<input value={draft.vehicleModel || ""} onChange={(e) => setDraft({ ...draft, vehicleModel: e.target.value })}/></label><button className={styles.primary} onClick={onSave}>保存车辆资料</button></div><section className={styles.detailSection}><h3>关联司机与订单</h3>{row.assignments.length ? <ul>{row.assignments.map((item, index) => <li key={`${item.order.platformOrderNumber}-${index}`}><b>{item.driverProfile?.displayName || "无名氏"}</b><span>{item.order.platformOrderNumber} · {item.order.serviceDate}</span></li>)}</ul> : <p>暂无历史搭配。</p>}</section><section className={styles.detailSection}><h3>资料状态</h3><p>{[row.brand, row.vehicleCategory, row.vehicleModel].filter(Boolean).length === 3 ? "品牌、类别和具体车型均已填写。" : "仍有资料待人工补充。"}</p></section></>;
}
