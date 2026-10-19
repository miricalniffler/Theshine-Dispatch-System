"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DispatchPreviewDialog } from "@/features/dispatch/DispatchPreviewDialog";
import { CustomerContactPreviewDialog } from "@/features/customer-notifications/CustomerContactPreviewDialog";
import { IwayPreviewDialog } from "@/features/iway/IwayPreviewDialog";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import type { DashboardSummary, Order, OrderFilters } from "./types";
import "./orders.css";
import "./orders-table-layout.css";

const exceptionLabels = { MISSING_CUSTOMER_PHONE: "缺少客人电话", AIRPORT_GUIDE_MISSING: "缺少机场指引", AIRPORT_UNRESOLVED: "机场无法确定", CUSTOMER_REPLY_REVIEW: "客人回复待查看", CUSTOMER_ORDER_DISCREPANCY: "客人说订单有误", UNUSUAL_LUGGAGE: "行李偏多", VEHICLE_CAPACITY_RISK: "车型承载风险", VEHICLE_CAPACITY_RULE_MISSING: "缺车型承载规则", DRIVER_NOTIFICATION_INCOMPLETE: "司机通知资料不完整" };
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
  const missing = missingDriverFields(order);
  const driver = order.driverDetail;
  if (!driver) return <span className="v3-driver-waiting">等待车队回复</span>;
  if (missing.length) return <span className="v3-driver-missing">⚠ 缺{missing.join("、")}</span>;
  return <><span className="v3-primary-line">{driver.confirmedDriverName}</span><small>{driver.confirmedVehicleModel} · {driver.licensePlate}</small></>;
}
function summaryFor(orders: Order[]): DashboardSummary {
  return {
    total: orders.length,
    waitingFleetReply: orders.filter((order) => !order.driverDetail).length,
    incompleteDriver: orders.filter((order) => Boolean(order.driverDetail) && missingDriverFields(order).length > 0).length,
    readyIwayReturn: orders.filter((order) => Boolean(order.driverDetail) && missingDriverFields(order).length === 0).length,
    exceptions: orders.filter((order) => order.exceptions.length > 0).length,
  };
}

export function OrderDashboard() {
  const [filters, setFilters] = useState<OrderFilters>({ dateMode: "window" });
  const [orders, setOrders] = useState<Order[]>([]); const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"dispatch" | "customer-contact" | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailAction, setDetailAction] = useState<"edit" | "note" | "cancel">("edit");
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [iwayOrderIds, setIwayOrderIds] = useState<string[] | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [syncingMail, setSyncingMail] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
  const update = (key: keyof OrderFilters, value: string) => { setSelected([]); setFilters((current) => ({ ...current, [key]: value || undefined })); };
  const allSelected = orders.length > 0 && selected.length === orders.length;
  const toggleOne = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
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
      <div className="v3-batch"><div><div className="v3-batch-title"><b>{selected.length ? `已选择 ${selected.length} 笔订单` : "先勾选订单"}</b></div><p>可批量生成车队派单、i’way 回传或客人首联内容。客人联系目前只生成内部待发送记录，不会真实发送 WhatsApp。</p></div><div className="v3-batch-actions"><button className="v3-primary" disabled={!selected.length} onClick={() => setModal("dispatch")}>批量生成车队派单</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setModal("customer-contact")}>批量联系客人</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setIwayOrderIds(selected)}>回传 i’way</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setSelected([])}>清除选择</button></div></div>
      <div className="v3-table-wrap"><table className="v3-orders-table"><colgroup><col className="v3-col-select"/><col className="v3-col-time"/><col className="v3-col-order"/><col className="v3-col-passenger"/><col className="v3-col-fleet"/><col className="v3-col-driver"/></colgroup><thead><tr><th className="v3-select"><label><input aria-label="全选订单" type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : orders.map((order) => order.id))}/>全选</label></th><th>接客时间</th><th>订单号</th><th>乘客 / 路线</th><th>车型 / 车队</th><th>司机 / 车辆</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6} className="v3-empty">正在加载订单…</td></tr> : !orders.length ? <tr><td colSpan={6} className="v3-empty">当前范围没有已核实的订单</td></tr> : orders.map((order) => <tr key={order.id}><td className="v3-select"><label><input aria-label={`选择 ${order.orderNo}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>选择</label></td><td className="v3-time-cell"><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city}</small></td><td className="v3-order-cell"><Link onClick={(event) => { event.preventDefault(); setDetailAction("edit"); setDetailOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link>{order.status === "CANCELLED" && <small className="v3-cancel-reason">已取消：{order.cancelReason || "未记录"}</small>}</td><td className="v3-passenger-cell"><span className="v3-primary-line">{order.passengerName}</span><small title={order.route}>{order.route}</small>{order.latestExceptionNote && <small>备注：{order.latestExceptionNote}</small>}</td><td className="v3-fleet-cell"><span className="v3-primary-line">{order.vehicleType}</span><small title={order.fleetName}>{order.fleetName}</small></td><td className="v3-driver-cell"><DriverVehicle order={order} /></td></tr>)}
      </tbody></table></div>
      <div className="v3-mobile-orders" aria-live="polite">
        {loading ? <p className="v3-mobile-empty">正在加载订单…</p> : !orders.length ? <p className="v3-mobile-empty">当前范围没有已核实的订单</p> : orders.map((order) => <article className="v3-mobile-order" key={order.id}>
          <header><label className="v3-mobile-select"><input aria-label={`选择 ${order.orderNo}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>选择</label></header>
          <div className="v3-mobile-order-main"><div><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city} · {order.fleetName}</small></div><Link onClick={(event) => { event.preventDefault(); setDetailAction("edit"); setDetailOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link></div>
          <p className="v3-mobile-passenger">{order.passengerName}</p><p className="v3-mobile-route">{order.route}</p>{order.latestExceptionNote && <p className="v3-mobile-route">备注：{order.latestExceptionNote}</p>}{order.status === "CANCELLED" && <p className="v3-mobile-route">已取消：{order.cancelReason || "未记录"}</p>}
          <footer><span>{order.vehicleType}</span><DriverVehicle order={order} /></footer>
        </article>)}
      </div>
    </section>
    {modal === "dispatch" && <DispatchPreviewDialog orderIds={selected} onClose={() => setModal(null)}/>}
    {modal === "customer-contact" && <CustomerContactPreviewDialog orderIds={selected} onClose={() => setModal(null)} />}
    {previewOrder && <DispatchPreviewDialog orderIds={[previewOrder.id]} mode="single" onClose={() => setPreviewOrder(null)} editHref={`/orders/${previewOrder.id}`} />}
    {iwayOrderIds && <IwayPreviewDialog orderIds={iwayOrderIds} onClose={() => setIwayOrderIds(null)} />}
    <OrderDetailDrawer order={detailOrder} initialAction={detailAction} onChanged={() => setRefreshVersion((version) => version + 1)} onClose={() => setDetailOrder(null)} onDispatch={(order) => { setDetailOrder(null); setPreviewOrder(order); }} />
  </main>;
}
function Metric({ value, label }: { value?: number; label: string }) { return <article><b>{value ?? "–"}</b><span>{label}</span></article>; }
