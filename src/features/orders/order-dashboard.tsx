"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DispatchPreviewDialog } from "@/features/dispatch/DispatchPreviewDialog";
import { CustomerContactPreviewDialog } from "@/features/customer-notifications/CustomerContactPreviewDialog";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import type { DashboardSummary, Order, OrderFilters } from "./types";
import "./orders.css";
import "./orders-table-layout.css";

const exceptionLabels = { MISSING_CUSTOMER_PHONE: "缺少客人电话", AIRPORT_GUIDE_MISSING: "缺少机场指引", AIRPORT_UNRESOLVED: "机场无法确定", CUSTOMER_REPLY_REVIEW: "客人回复待查看", CUSTOMER_ORDER_DISCREPANCY: "客人说订单有误", UNUSUAL_LUGGAGE: "行李偏多", VEHICLE_CAPACITY_RISK: "车型承载风险", VEHICLE_CAPACITY_RULE_MISSING: "缺车型承载规则", DRIVER_NOTIFICATION_INCOMPLETE: "司机通知资料不完整" };
type SyncRun = { status: "REQUESTED" | "RUNNING" | "SUCCEEDED" | "FAILED"; startedAt?: string; completedAt?: string | null; createdCount: number; updatedCount: number; cancelledCount: number; skippedCount: number; errorMessage?: string | null };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); }
function displayToday() { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Bangkok", year: "numeric", month: "long", day: "numeric" }).format(new Date()); }
function displaySyncFailure(message: string) {
  if (/need_user_authorization|token_missing|lark-cli auth login/i.test(message)) {
    return "飞书邮箱授权已失效，暂时无法同步。请在安装同步助手的电脑上重新登录飞书后再试。";
  }
  return message || "飞书同步暂时失败，请稍后再试；已有订单不会受影响。";
}
function missingDriverFields(order: Order) {
  const driver = order.driverDetail;
  if (!driver) return ["司机资料"];
  return [
    !driver.confirmedDriverName ? "司机姓名" : "",
    !driver.normalizedDriverPhone ? "司机电话" : "",
    !driver.confirmedVehicleModel ? "车型" : "",
    !driver.licensePlate ? "车牌" : "",
  ].filter(Boolean);
}
function DriverVehicle({ order }: { order: Order }) {
  if (order.status === "CANCELLED") return <span className="v3-driver-missing">已取消</span>;
  const missing = missingDriverFields(order);
  const driver = order.driverDetail;
  if (!driver) return <span className="v3-driver-waiting">等待车队回复</span>;
  if (missing.length) return <span className="v3-driver-missing">⚠ 缺{missing.join("、")}</span>;
  return <><span className="v3-primary-line">{driver.confirmedDriverName}</span><small>{driver.confirmedVehicleModel} · {driver.licensePlate}</small></>;
}
function summaryFor(orders: Order[]): DashboardSummary {
  return {
    total: orders.length,
    waitingFleetReply: orders.filter((order) => order.status !== "CANCELLED" && !order.driverDetail).length,
    incompleteDriver: orders.filter((order) => order.status !== "CANCELLED" && Boolean(order.driverDetail) && missingDriverFields(order).length > 0).length,
    readyIwayReturn: orders.filter((order) => order.status !== "CANCELLED" && Boolean(order.driverDetail) && missingDriverFields(order).length === 0).length,
    exceptions: orders.filter((order) => order.exceptions.length > 0).length,
  };
}

export function OrderDashboard() {
  const [filters, setFilters] = useState<OrderFilters>({ dateMode: "window" });
  const [orders, setOrders] = useState<Order[]>([]); const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"dispatch" | "customer-contact" | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [syncingMail, setSyncingMail] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [iwayPreview, setIwayPreview] = useState<{ valid: boolean; errors: string[]; text?: string; orderCount: number; ruleVersion?: string } | null>(null);
  const [iwayBusy, setIwayBusy] = useState(false);
  const [iwayNotice, setIwayNotice] = useState("");
  async function showIwayPreview() {
    if (!selected.length) return;
    setIwayBusy(true); setIwayNotice(""); setIwayPreview(null);
    try {
      const response = await fetch("/api/iway-return-batches/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: selected }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "生成回传信息失败");
      setIwayPreview(payload.data);
    } catch (error) { setIwayNotice(error instanceof Error ? error.message : "生成回传信息失败"); }
    finally { setIwayBusy(false); }
  }
  async function copyIwayPreview() {
    if (!iwayPreview?.valid || !iwayPreview.text) return;
    try {
      await navigator.clipboard.writeText(iwayPreview.text);
      setIwayNotice("已复制回传信息，可以粘贴到 i’way 群聊。复制不代表已发送。");
    } catch { setIwayNotice("自动复制失败，请选中下方文本手动复制。"); }
  }
  const query = useMemo(() => { const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); return params.toString(); }, [filters]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/orders?${query}`, { cache: "no-store" }).then((response) => response.json())
      .then((orderResponse) => {
        if (!active) return;
        const nextOrders = orderResponse.data || [];
        setOrders(nextOrders);
        setSummary(summaryFor(nextOrders));
        setLastRefreshedAt(new Date());
      }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query, refreshVersion]);
  async function syncMailAndRefresh() {
    setSyncingMail(true);
    setSyncMessage("正在从飞书读取订单…");
    try {
      const response = await fetch("/api/import-sync/feishu-mail", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "同步请求发送失败");
      if (payload.data?.localScheduled) {
        setSyncMessage("本机飞书助手正在按周期自动同步；正在等待下一轮结果…");
        const requestedAt = Date.now();
        while (Date.now() - requestedAt < 90_000) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
          const statusResponse = await fetch("/api/import-sync/feishu-mail", { cache: "no-store" });
          const statusPayload = await statusResponse.json();
          const run = statusPayload.data?.latestRun as SyncRun | undefined;
          const completedAt = Date.parse(run?.completedAt || run?.startedAt || "");
          if (!run || run.status === "RUNNING" || Number.isNaN(completedAt) || completedAt < requestedAt) continue;
          if (run.status === "FAILED") throw new Error(displaySyncFailure(run.errorMessage || ""));
          setRefreshVersion((version) => version + 1);
          setSyncMessage(`飞书同步完成：新增 ${run.createdCount} 笔，更新 ${run.updatedCount} 笔，取消 ${run.cancelledCount} 笔，跳过 ${run.skippedCount} 笔。订单列表已刷新。`);
          return;
        }
        setSyncMessage("本机同步助手尚未完成下一轮。请保持这台电脑唤醒；它会继续自动同步，不需要再次点击按钮。");
        return;
      }
      if (payload.data?.alreadyRunning) {
        setSyncMessage("已有一轮飞书同步正在进行，请等待完成后刷新订单列表。");
        return;
      }
      const result = payload.data;
      setRefreshVersion((version) => version + 1);
      setSyncMessage(`飞书同步完成：新增 ${result.created} 笔，更新 ${result.updated} 笔，取消 ${result.cancelled} 笔，跳过 ${result.skipped} 笔。订单列表已刷新。`);
    } catch (error) {
      setSyncMessage(error instanceof Error ? displaySyncFailure(error.message) : "飞书同步失败，请稍后重试。");
    } finally {
      setSyncingMail(false);
    }
  }
  const update = (key: keyof OrderFilters, value: string) => { setIwayPreview(null); setSelected([]); setFilters((current) => ({ ...current, [key]: value || undefined })); };
  const selectableOrders = orders.filter((order) => order.status !== "CANCELLED");
  const allSelected = selectableOrders.length > 0 && selected.length === selectableOrders.length;
  const toggleOne = (id: string) => { setIwayPreview(null); setIwayNotice(""); setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); };
  return <main className="v3-page">
    <header className="v3-top"><div><h1>订单工作台</h1><p>{displayToday()} · 默认今天至未来 7 日</p><small className="v3-sync-state">订单仅在首次打开、筛选变更或你手动刷新时更新{lastRefreshedAt ? ` · 最后刷新 ${lastRefreshedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}{syncMessage ? ` · ${syncMessage}` : ""}</small></div><div className="v3-top-actions"><a className="v3-secondary" href="/import">手动录入订单</a><button className="v3-secondary" type="button" onClick={syncMailAndRefresh} disabled={loading || syncingMail}>{syncingMail ? "正在同步飞书…" : "同步飞书并刷新"}</button></div></header>
    <section className="v3-metrics" aria-label="订单概览">
      <Metric value={summary?.waitingFleetReply} label="等待车队回复"/><Metric value={summary?.incompleteDriver} label="司机资料需补充"/><Metric value={summary?.readyIwayReturn} label="可回传 i’way"/><Metric value={summary?.exceptions} label="异常订单"/>
    </section>
    <section className="v3-card">
      <button className="v3-mobile-filter-toggle" type="button" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen((open) => !open)}>
        {mobileFiltersOpen ? "收起筛选" : "筛选订单"}
      </button>
      <div className={`v3-filters ${mobileFiltersOpen ? "is-open" : ""}`}>
        <select aria-label="日期范围" value={filters.dateMode} onChange={(event) => update("dateMode", event.target.value)}><option value="window">今天至未来 7 日</option><option value="today">今天</option><option value="tomorrow">明天</option><option value="month">本月</option><option value="future">未来全部日期</option><option value="range">自定义日期范围</option></select>
        {filters.dateMode === "range" && <><input aria-label="开始日期" type="date" value={filters.startDate || today()} onInput={(event) => update("startDate", event.currentTarget.value)} onChange={(event) => update("startDate", event.target.value)}/><input aria-label="结束日期" type="date" value={filters.endDate || ""} onInput={(event) => update("endDate", event.currentTarget.value)} onChange={(event) => update("endDate", event.target.value)}/></>}
        <select aria-label="城市" value={filters.city || ""} onChange={(event) => update("city", event.target.value)}><option value="">全部城市</option><option>曼谷</option><option>苏梅</option></select>
        <select aria-label="车队" value={filters.fleet || ""} onChange={(event) => update("fleet", event.target.value)}><option value="">全部车队</option><option>曼谷车队</option><option>苏梅车队</option></select>
        <select aria-label="异常" value={filters.exception || ""} onChange={(event) => update("exception", event.target.value)}><option value="">全部异常</option>{Object.entries(exceptionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <input aria-label="关键词" placeholder="订单号 / 乘客 / 电话" value={filters.keyword || ""} onChange={(event) => update("keyword", event.target.value)}/>
        <button className="v3-secondary v3-filter-desktop-button" type="button" onClick={() => setMobileFiltersOpen((open) => !open)}>筛选</button>
      </div>
      <div className="v3-batch"><div><div className="v3-batch-title"><b>{selected.length ? `已选择 ${selected.length} 笔订单` : "先勾选订单"}</b></div><p>可批量生成车队派单、i’way 回传或客人首联内容。客人联系目前只生成内部待发送记录，不会真实发送 WhatsApp。</p></div><div className="v3-batch-actions"><button className="v3-primary" disabled={!selected.length} onClick={() => setModal("dispatch")}>批量生成车队派单</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setModal("customer-contact")}>批量联系客人</button><button className="v3-secondary" disabled={!selected.length || iwayBusy} onClick={() => void showIwayPreview()}>{iwayBusy ? "正在生成…" : "批量回传 i’way"}</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setSelected([])}>清除选择</button></div></div>
      {iwayPreview && <section aria-label="iway 回传预览" style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 18, margin: "16px 0", background: "#f8fafc" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 19 }}>i’way 回传信息 · {iwayPreview.orderCount} 笔订单</h2><button className="v3-secondary" type="button" onClick={() => setIwayPreview(null)}>关闭预览</button></div>
        {iwayPreview.ruleVersion && <p style={{ fontSize: 12, color: "#64748b" }}>回传规则：{iwayPreview.ruleVersion}</p>}
        {iwayPreview.errors?.length ? <div role="alert" style={{ color: "#b42318" }}><strong>部分资料不完整，请补充后重新生成：</strong>{iwayPreview.errors.map((message, index) => <p key={index}>{message}</p>)}</div> : null}
        {iwayPreview.text && <textarea aria-label="可复制的 iway 回传内容" readOnly value={iwayPreview.text} rows={Math.min(20, Math.max(7, iwayPreview.text.split("\n").length + 1))} style={{ display: "block", width: "100%", marginTop: 12, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, fontFamily: "monospace", whiteSpace: "pre-wrap" }} />}
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}><button className="v3-primary" type="button" disabled={!iwayPreview.valid || !iwayPreview.text} onClick={() => void copyIwayPreview()}>复制回传信息</button><button className="v3-secondary" type="button" onClick={() => void showIwayPreview()}>重新生成</button></div>
        {iwayNotice && <p role="status">{iwayNotice}</p>}
        <p style={{ color: "#64748b", fontSize: 12 }}>仅生成和复制文本，不会自动发送，也不会改变订单回传状态。</p>
      </section>}
      {!iwayPreview && iwayNotice && <p role="alert">{iwayNotice}</p>}
      <div className="v3-table-wrap"><table className="v3-orders-table"><colgroup><col className="v3-col-select"/><col className="v3-col-time"/><col className="v3-col-order"/><col className="v3-col-passenger"/><col className="v3-col-fleet"/><col className="v3-col-driver"/></colgroup><thead><tr><th className="v3-select"><label><input aria-label="全选订单" type="checkbox" checked={allSelected} onChange={() => { setIwayPreview(null); setIwayNotice(""); setSelected(allSelected ? [] : selectableOrders.map((order) => order.id)); }}/>全选</label></th><th>接客时间</th><th>订单号</th><th>乘客 / 路线</th><th>车型 / 车队</th><th>司机 / 车辆</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6} className="v3-empty">正在加载订单…</td></tr> : !orders.length ? <tr><td colSpan={6} className="v3-empty">当前范围没有已核实的订单</td></tr> : orders.map((order) => <tr key={order.id}><td className="v3-select"><label><input aria-label={`选择 ${order.orderNo}`} type="checkbox" disabled={order.status === "CANCELLED"} checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>{order.status === "CANCELLED" ? "已取消" : "选择"}</label></td><td className="v3-time-cell"><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city}</small></td><td className="v3-order-cell"><Link onClick={(event) => { event.preventDefault(); setDetailOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link></td><td className="v3-passenger-cell"><span className="v3-primary-line">{order.passengerName}</span><small title={order.route}>{order.route}</small></td><td className="v3-fleet-cell"><span className="v3-primary-line">{order.vehicleType}</span><small title={order.fleetName}>{order.fleetName}</small></td><td className="v3-driver-cell"><DriverVehicle order={order} /></td></tr>)}
      </tbody></table></div>
      <div className="v3-mobile-orders" aria-live="polite">
        {loading ? <p className="v3-mobile-empty">正在加载订单…</p> : !orders.length ? <p className="v3-mobile-empty">当前范围没有已核实的订单</p> : orders.map((order) => <article className="v3-mobile-order" key={order.id}>
          <header><label className="v3-mobile-select"><input aria-label={`选择 ${order.orderNo}`} type="checkbox" disabled={order.status === "CANCELLED"} checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>{order.status === "CANCELLED" ? "已取消" : "选择"}</label></header>
          <div className="v3-mobile-order-main"><div><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city} · {order.fleetName}</small></div><Link onClick={(event) => { event.preventDefault(); setDetailOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link></div>
          <p className="v3-mobile-passenger">{order.passengerName}</p><p className="v3-mobile-route">{order.route}</p>
          <footer><span>{order.vehicleType}</span><DriverVehicle order={order} /></footer>
        </article>)}
      </div>
    </section>
    {modal === "dispatch" && <DispatchPreviewDialog orderIds={selected} onClose={() => setModal(null)}/>}
    {modal === "customer-contact" && <CustomerContactPreviewDialog orderIds={selected} onClose={() => setModal(null)} />}
    {previewOrder && <DispatchPreviewDialog orderIds={[previewOrder.id]} mode="single" onClose={() => setPreviewOrder(null)} editHref={`/orders/${previewOrder.id}`} />}
    <OrderDetailDrawer order={detailOrder} onClose={() => setDetailOrder(null)} onDispatch={(order) => { setDetailOrder(null); setPreviewOrder(order); }} />
  </main>;
}
function Metric({ value, label }: { value?: number; label: string }) { return <article><b>{value ?? "–"}</b><span>{label}</span></article>; }
