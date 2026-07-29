"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DispatchPreviewDialog } from "@/features/dispatch/DispatchPreviewDialog";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import type { DashboardSummary, Order, OrderFilters, OrderStatus } from "./types";
import "./orders.css";
import "./orders-table-layout.css";

const statusLabels: Record<OrderStatus, string> = { PENDING_REVIEW: "待核对", READY_TO_DISPATCH: "待派车", DISPATCHED: "待司机资料", DRIVER_CONFIRMED: "待回传平台", RETURNED: "已回传", COMPLETED: "已完成" };
const exceptionLabels = { MISSING_FIELD: "字段缺失", DUPLICATE_SUSPECT: "疑似重复", DUE_SOON: "临近服务" };
type SyncRun = { status: "REQUESTED" | "RUNNING" | "SUCCEEDED" | "FAILED"; createdCount: number; updatedCount: number; cancelledCount: number; skippedCount: number; errorMessage?: string | null };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); }
function displayToday() { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Bangkok", year: "numeric", month: "long", day: "numeric" }).format(new Date()); }
function nextAction(order: Order) {
  if (order.status === "PENDING_REVIEW") return "核对订单";
  if (order.status === "READY_TO_DISPATCH") return "去派车";
  if (order.status === "DISPATCHED") return "录入司机资料";
  if (order.status === "DRIVER_CONFIRMED" || order.status === "RETURNED") return "生成回传";
  return "查看详情";
}
function summaryFor(orders: Order[]): DashboardSummary {
  return {
    total: orders.length,
    pendingReview: orders.filter((order) => order.status === "PENDING_REVIEW").length,
    readyToDispatch: orders.filter((order) => order.status === "READY_TO_DISPATCH").length,
    dispatched: orders.filter((order) => order.status === "DISPATCHED").length,
    pendingDriver: orders.filter((order) => order.status === "DISPATCHED").length,
    pendingReturn: orders.filter((order) => order.status === "DRIVER_CONFIRMED" || order.status === "RETURNED").length,
    exceptions: orders.filter((order) => order.exceptions.length > 0).length,
  };
}

export function OrderDashboard() {
  const [filters, setFilters] = useState<OrderFilters>({ dateMode: "window" });
  const [orders, setOrders] = useState<Order[]>([]); const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"dispatch" | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
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
    setSyncMessage("正在请求飞书订单，请稍候…");
    try {
      const response = await fetch("/api/import-sync/feishu-mail", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "同步请求发送失败");
      const startedAt = Date.now();
      while (Date.now() - startedAt < 150_000) {
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
        const statusResponse = await fetch("/api/import-sync/feishu-mail", { cache: "no-store" });
        const statusPayload = await statusResponse.json();
        const run = statusPayload.data?.latestRun as SyncRun | undefined;
        if (!run || run.status === "REQUESTED" || run.status === "RUNNING") continue;
        if (run.status === "FAILED") throw new Error(run.errorMessage || "飞书同步失败");
        setRefreshVersion((version) => version + 1);
        setSyncMessage(`飞书同步完成：新增 ${run.createdCount} 笔，更新 ${run.updatedCount} 笔。订单列表已刷新。`);
        return;
      }
      setSyncMessage("同步请求已发出，仍在处理中。请稍后再点击一次；订单不会丢失。");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "飞书同步失败，请稍后重试。");
    } finally {
      setSyncingMail(false);
    }
  }
  const update = (key: keyof OrderFilters, value: string) => { setSelected([]); setFilters((current) => ({ ...current, [key]: value || undefined })); };
  const allSelected = orders.length > 0 && selected.length === orders.length;
  const toggleOne = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <main className="v3-page">
    <header className="v3-top"><div><h1>订单工作台</h1><p>{displayToday()} · 默认今天至未来 7 日</p><small className="v3-sync-state">订单仅在首次打开、筛选变更或你手动刷新时更新{lastRefreshedAt ? ` · 最后刷新 ${lastRefreshedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}{syncMessage ? ` · ${syncMessage}` : ""}</small></div><div className="v3-top-actions"><button className="v3-secondary" type="button" onClick={syncMailAndRefresh} disabled={loading || syncingMail}>{syncingMail ? "正在同步飞书…" : "同步飞书并刷新"}</button></div></header>
    <section className="v3-metrics" aria-label="订单概览">
      <Metric value={summary?.pendingReview} label="待核对"/><Metric value={summary?.readyToDispatch} label="待派车"/><Metric value={summary?.pendingDriver} label="待司机资料"/><Metric value={summary?.pendingReturn} label="待回传 i’way"/><Metric value={summary?.exceptions} label="异常 / 临近"/>
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
        <select aria-label="状态" value={filters.status || ""} onChange={(event) => update("status", event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select aria-label="异常" value={filters.exception || ""} onChange={(event) => update("exception", event.target.value)}><option value="">全部异常</option>{Object.entries(exceptionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <input aria-label="关键词" placeholder="订单号 / 乘客 / 电话" value={filters.keyword || ""} onChange={(event) => update("keyword", event.target.value)}/>
        <button className="v3-secondary v3-filter-desktop-button" type="button" onClick={() => setMobileFiltersOpen((open) => !open)}>筛选</button>
      </div>
      <div className="v3-batch"><div><div className="v3-batch-title"><b>{selected.length ? `已选择 ${selected.length} 笔订单` : "先勾选订单"}</b></div><p>派给车队：同一服务日、同一城市、同一车队。回传 i’way：先录入车队回复，再生成回传内容。</p></div><div className="v3-batch-actions"><button className="v3-primary" disabled={!selected.length} onClick={() => setModal("dispatch")}>批量派给车队</button><button className="v3-secondary" onClick={() => window.location.assign("/driver-details")}>回传 i’way</button><button className="v3-secondary" disabled={!selected.length} onClick={() => setSelected([])}>清除选择</button></div></div>
      <div className="v3-table-wrap"><table className="v3-orders-table"><colgroup><col className="v3-col-select"/><col className="v3-col-time"/><col className="v3-col-order"/><col className="v3-col-passenger"/><col className="v3-col-fleet"/><col className="v3-col-status"/><col className="v3-col-action"/></colgroup><thead><tr><th className="v3-select"><label><input aria-label="全选订单" type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : orders.map((order) => order.id))}/>全选</label></th><th>接客时间</th><th>订单号</th><th>乘客 / 路线</th><th>车型 / 车队</th><th>状态</th><th>下一步</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} className="v3-empty">正在加载订单…</td></tr> : !orders.length ? <tr><td colSpan={7} className="v3-empty">当前范围没有已核实的订单</td></tr> : orders.map((order) => <tr key={order.id}><td className="v3-select"><label><input aria-label={`选择 ${order.orderNo}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>选择</label></td><td className="v3-time-cell"><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city}</small></td><td className="v3-order-cell"><Link onClick={(event) => { event.preventDefault(); setPreviewOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link></td><td className="v3-passenger-cell"><span className="v3-primary-line">{order.passengerName}</span><small title={order.route}>{order.route}</small></td><td className="v3-fleet-cell"><span className="v3-primary-line">{order.vehicleType}</span><small title={order.fleetName}>{order.fleetName}</small></td><td className="v3-status-cell"><span className={`v3-tag ${order.status}`}>{statusLabels[order.status]}</span></td><td className="v3-action-cell">{order.status === "READY_TO_DISPATCH" ? <button type="button" className="v3-secondary v3-next" onClick={() => setPreviewOrder(order)}>去派车</button> : order.status === "DISPATCHED" ? <Link className="v3-secondary v3-next" href={`/driver-details?orderId=${order.id}`}>录入司机资料</Link> : <Link onClick={(event) => { event.preventDefault(); setDetailOrder(order); }} className="v3-secondary v3-next" href={`/orders/${order.id}`}>{nextAction(order)}</Link>}</td></tr>)}
      </tbody></table></div>
      <div className="v3-mobile-orders" aria-live="polite">
        {loading ? <p className="v3-mobile-empty">正在加载订单…</p> : !orders.length ? <p className="v3-mobile-empty">当前范围没有已核实的订单</p> : orders.map((order) => <article className="v3-mobile-order" key={order.id}>
          <header><label className="v3-mobile-select"><input aria-label={`选择 ${order.orderNo}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)}/>选择</label><span className={`v3-tag ${order.status}`}>{statusLabels[order.status]}</span></header>
          <div className="v3-mobile-order-main"><div><b>{order.serviceDate.slice(5).replace("-", "/")} {order.pickupTime}</b><small>{order.city} · {order.fleetName}</small></div><Link onClick={(event) => { event.preventDefault(); setPreviewOrder(order); }} href={`/orders/${order.id}`}>{order.orderNo}</Link></div>
          <p className="v3-mobile-passenger">{order.passengerName}</p><p className="v3-mobile-route">{order.route}</p>
          <footer><span>{order.vehicleType}</span>{order.status === "READY_TO_DISPATCH" ? <button type="button" className="v3-secondary v3-next" onClick={() => setPreviewOrder(order)}>去派车</button> : order.status === "DISPATCHED" ? <Link className="v3-secondary v3-next" href={`/driver-details?orderId=${order.id}`}>录入资料</Link> : <Link onClick={(event) => { event.preventDefault(); setDetailOrder(order); }} className="v3-secondary v3-next" href={`/orders/${order.id}`}>{nextAction(order)}</Link>}</footer>
        </article>)}
      </div>
    </section>
    {modal === "dispatch" && <DispatchPreviewDialog orderIds={selected} onClose={() => setModal(null)}/>}
    {previewOrder && <DispatchPreviewDialog orderIds={[previewOrder.id]} mode="single" onClose={() => setPreviewOrder(null)} editHref={`/orders/${previewOrder.id}`} />}
    <OrderDetailDrawer order={detailOrder} onClose={() => setDetailOrder(null)} />
  </main>;
}
function Metric({ value, label }: { value?: number; label: string }) { return <article><b>{value ?? "–"}</b><span>{label}</span></article>; }
