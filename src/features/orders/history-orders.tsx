"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Order } from "./types";
import "./history-orders.css";

const statusLabels: Record<string, string> = {
  PENDING_REVIEW: "待核对",
  READY_TO_DISPATCH: "待派车",
  DISPATCHED: "待司机资料",
  DRIVER_CONFIRMED: "待回传平台",
  RETURNED: "已回传",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function HistoryOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams({ dateMode: startDate || endDate ? "range" : "all" });
    if (city) params.set("city", city);
    if (status) params.set("status", status);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return params.toString();
  }, [city, status, keyword, startDate, endDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const response = await fetch(`/api/orders?${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.data)) throw new Error(payload?.error?.message || "历史订单读取失败，请重试。");
        if (active) setOrders(payload.data);
      } catch (error) {
        if (active) { setOrders([]); setLoadError(error instanceof Error ? error.message : "历史订单读取失败，请重试。"); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [query, refreshVersion]);

  return <main className="history-page">
    <header className="history-header"><div><p>订单档案</p><h1>历史订单</h1><span>所有已导入订单都会保留在这里，按接客时间由早到晚排列。</span></div><button type="button" className="history-refresh" onClick={() => setRefreshVersion((version) => version + 1)} disabled={loading}>{loading ? "读取中…" : "手动刷新"}</button></header>
    <section className="history-filter-shell" aria-label="历史订单筛选"><button className="history-mobile-filter-toggle" type="button" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen((open) => !open)}>{mobileFiltersOpen ? "收起筛选" : "筛选历史订单"}</button><div className={`history-filter ${mobileFiltersOpen ? "is-open" : ""}`}><label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>结束日期<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label>城市<select value={city} onChange={(event) => setCity(event.target.value)}><option value="">全部城市</option><option value="曼谷">曼谷</option><option value="苏梅">苏梅</option></select></label><label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="history-search">查找订单<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="订单号、客人姓名或电话" /></label></div></section>
    <section className="history-table-card">{loadError && <p role="alert" className="history-empty">历史订单未能读取：{loadError} <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>重试</button></p>}<div className="history-table-title"><b>共 {orders.length} 笔订单</b><span>点击订单号可打开并编辑</span></div><div className="history-table-wrap"><table><thead><tr><th>接客时间</th><th>订单号</th><th>客人</th><th>城市 / 车队</th><th>车型</th><th>状态</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="history-empty">正在读取历史订单…</td></tr> : !orders.length ? <tr><td colSpan={6} className="history-empty">没有符合条件的历史订单</td></tr> : orders.map((order) => <tr key={order.id}><td><b>{order.serviceDate}</b><small>{order.pickupTime}</small></td><td><Link href={`/orders/${order.id}`}>{order.orderNo}</Link></td><td><b>{order.passengerName}</b><small>{order.passengerPhone}</small></td><td>{order.city}<small>{order.fleetName}</small></td><td>{order.vehicleType}</td><td><span className={`history-status ${order.status}`}>{statusLabels[order.status] || order.status}</span></td></tr>)}</tbody></table></div><div className="history-mobile-list" aria-live="polite">{loading ? <p className="history-mobile-empty">正在读取历史订单…</p> : !orders.length ? <p className="history-mobile-empty">没有符合条件的历史订单</p> : orders.map((order) => <article className="history-mobile-order" key={order.id}><header><div><b>{order.serviceDate} {order.pickupTime}</b><small>{order.city} · {order.fleetName}</small></div><span className={`history-status ${order.status}`}>{statusLabels[order.status] || order.status}</span></header><Link href={`/orders/${order.id}`}>{order.orderNo}</Link><p>{order.passengerName}</p><small className="history-mobile-phone">{order.passengerPhone}</small><footer><span>{order.vehicleType}</span><span>{order.route}</span></footer></article>)}</div></section>
  </main>;
}
