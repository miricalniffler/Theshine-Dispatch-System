"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardSummary, Order, OrderFilters, OrderStatus } from "./types";
import { DispatchPreviewDialog } from "@/features/dispatch/DispatchPreviewDialog";
import "./orders.css";

const statusLabels: Record<OrderStatus, string> = {
  PENDING_REVIEW: "待核对", READY_TO_DISPATCH: "待派单", DISPATCHED: "已派单",
  DRIVER_CONFIRMED: "司机已确认", RETURNED: "已回传", COMPLETED: "已完成",
};
const exceptionLabels = { MISSING_FIELD: "字段缺失", DUPLICATE_SUSPECT: "疑似重复", DUE_SOON: "临近服务" };

function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${value}T12:00:00`)); }

export function OrderDashboard() {
  const [filters, setFilters] = useState<OrderFilters>({ dateMode: "today" });
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDispatchPreview, setShowDispatchPreview] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetch(`/api/orders?${query}`).then((r) => r.json()), fetch(`/api/dashboard/summary?${query}`).then((r) => r.json())])
      .then(([orderResponse, summaryResponse]) => {
        if (!active) return;
        setOrders(orderResponse.data); setSummary(summaryResponse.data); setSelected([]);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query]);

  const updateFilter = (key: keyof OrderFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  const setDateMode = (dateMode: NonNullable<OrderFilters["dateMode"]>) => setFilters((current) => ({ ...current, dateMode }));
  const allSelected = orders.length > 0 && selected.length === orders.length;
  const toggleAll = () => setSelected(allSelected ? [] : orders.map((order) => order.id));
  const toggleOne = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <main className="orders-page">
    <header className="orders-header">
      <div><p className="orders-kicker">订单工作台</p><h1>接送机订单</h1><p>先筛选服务日期，再查看异常与派单准备情况。</p></div>
      <div className="demo-note"><span>演示数据</span> 后续将连接正式订单库</div>
    </header>

    <section className="date-bar" aria-label="日期筛选">
      {([ ["today", "今天"], ["future", "未来日期"], ["range", "自定义范围"] ] as const).map(([mode, label]) => <button type="button" className={filters.dateMode === mode ? "active" : ""} onClick={() => setDateMode(mode)} key={mode}>{label}</button>)}
      {filters.dateMode === "range" && <div className="range-fields"><input aria-label="开始日期" type="date" value={filters.startDate || today()} onInput={(event) => updateFilter("startDate", event.currentTarget.value)} onChange={(event) => updateFilter("startDate", event.target.value)} /><span>至</span><input aria-label="结束日期" type="date" value={filters.endDate || ""} onInput={(event) => updateFilter("endDate", event.currentTarget.value)} onChange={(event) => updateFilter("endDate", event.target.value)} /></div>}
    </section>

    <section className="summary-grid" aria-label="订单概览">
      <SummaryCard label="订单总数" value={summary?.total} tone="blue" />
      <SummaryCard label="待核对" value={summary?.pendingReview} tone="amber" />
      <SummaryCard label="待派单" value={summary?.readyToDispatch} tone="violet" />
      <SummaryCard label="异常提醒" value={summary?.exceptions} tone="red" />
    </section>

    <section className="orders-panel">
      <div className="filter-row">
        <select aria-label="城市" value={filters.city || ""} onChange={(event) => updateFilter("city", event.target.value)}><option value="">全部城市</option><option>曼谷</option><option>苏梅</option></select>
        <select aria-label="车队" value={filters.fleet || ""} onChange={(event) => updateFilter("fleet", event.target.value)}><option value="">全部车队</option><option>Bangkok Premier Fleet</option><option>Siam Airport Service</option><option>Samui Island Transfer</option></select>
        <select aria-label="订单状态" value={filters.status || ""} onChange={(event) => updateFilter("status", event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select aria-label="异常类型" value={filters.exception || ""} onChange={(event) => updateFilter("exception", event.target.value)}><option value="">全部异常</option>{Object.entries(exceptionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <input className="keyword-input" aria-label="搜索订单" placeholder="订单号、乘客、电话或路线" value={filters.keyword || ""} onChange={(event) => updateFilter("keyword", event.target.value)} />
      </div>
      {selected.length > 0 && <div className="selection-bar"><strong>已选择 {selected.length} 个订单</strong><span>选择后可先生成派单预览；预览和复制都不会改变订单状态。</span><div className="selection-actions"><button className="selection-dispatch" type="button" onClick={() => setShowDispatchPreview(true)}>生成车队派单</button><button type="button" onClick={() => setSelected([])}>清除选择</button></div></div>}

      <div className="table-wrap">
        <table><thead><tr><th><input aria-label="全选订单" type="checkbox" checked={allSelected} onChange={toggleAll} /></th><th>服务时间</th><th>订单 / 乘客</th><th>路线与车型</th><th>城市 / 车队</th><th>状态</th><th>异常</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={7} className="empty-cell">正在加载订单…</td></tr> : orders.length === 0 ? <tr><td colSpan={7} className="empty-cell">没有符合筛选条件的订单</td></tr> : orders.map((order) => <tr className={order.exceptions.length ? "has-exception" : ""} key={order.id}>
            <td><input aria-label={`选择 ${order.orderNo}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOne(order.id)} /></td>
            <td><strong>{formatDate(order.serviceDate)}</strong><small>{order.pickupTime}</small></td>
            <td><strong><a href={`/orders/${order.id}`}>{order.orderNo}</a></strong><span>{order.passengerName}</span><small>{order.passengerPhone}</small></td>
            <td><span>{order.route}</span><small>{order.vehicleType}</small></td>
            <td><strong>{order.city}</strong><small>{order.fleetName}</small></td>
            <td><span className={`status status-${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span></td>
            <td>{order.exceptions.length ? <div className="exception-list">{order.exceptions.map((exception) => <span key={exception}>{exceptionLabels[exception]}</span>)}</div> : <span className="quiet">—</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    {showDispatchPreview && <DispatchPreviewDialog orderIds={selected} onClose={() => setShowDispatchPreview(false)} />}
  </main>;
}

function SummaryCard({ label, value, tone }: { label: string; value?: number; tone: string }) {
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{value ?? "–"}</strong><small>当前筛选范围</small></article>;
}
