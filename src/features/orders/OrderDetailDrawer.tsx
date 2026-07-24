"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Order } from "./types";
import "./order-detail-drawer.css";

type DetailedOrder = Record<string, unknown>;

export function OrderDetailDrawer({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailedOrder | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!order) { setDetail(null); return; }
    setLoading(true); setDetail(null);
    fetch(`/api/orders/${order.id}`, { cache: "no-store" }).then((response) => response.json()).then((json) => setDetail(json.data ?? null)).finally(() => setLoading(false));
  }, [order]);
  if (!order) return null;
  const field = (key: string) => String(detail?.[key] ?? "待核对");
  return <div className="order-drawer-overlay" role="presentation" onMouseDown={onClose}>
    <aside className="order-drawer" role="dialog" aria-modal="true" aria-label="订单详情侧边栏" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>订单详情</p><h2>{order.orderNo}</h2></div><button type="button" aria-label="关闭订单详情" onClick={onClose}>×</button></header>
      {loading ? <p className="order-drawer-loading">正在读取订单信息…</p> : <div className="order-drawer-body">
        <section><h3>乘客与服务</h3><Row label="乘客" value={field("passengerName")} /><Row label="电话" value={field("passengerPhone")} /><Row label="服务时间" value={detail?.pickupDateTime ? new Date(String(detail.pickupDateTime)).toLocaleString("zh-CN", { timeZone: "Asia/Bangkok" }) : `${order.serviceDate} ${order.pickupTime}`} /><Row label="城市" value={field("city")} /></section>
        <section><h3>行程与车型</h3><Row label="上车地点" value={field("pickupAddress")} /><Row label="下车地点" value={field("dropoffAddress")} /><Row label="航班号" value={field("flightNumber")} /><Row label="平台车型" value={field("platformVehicleType")} /></section>
        <section><h3>处理状态</h3><Row label="当前状态" value={field("status")} /><Row label="车队" value={order.fleetName} /></section>
      </div>}
      <footer><Link href={`/orders/${order.id}`}>打开完整订单并编辑</Link></footer>
    </aside>
  </div>;
}
function Row({ label, value }: { label: string; value: string }) { return <dl><dt>{label}</dt><dd>{value === "null" ? "—" : value}</dd></dl>; }
