"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Order } from "./types";
import "./order-detail-drawer.css";

type DetailedOrder = Record<string, unknown>;
type DriverDetail = { confirmedDriverName?: string | null; normalizedDriverPhone?: string | null; confirmedVehicleModel?: string | null; licensePlate?: string | null };

export function OrderDetailDrawer({ order, onClose, onDispatch }: { order: Order | null; onClose: () => void; onDispatch?: (order: Order) => void }) {
  const [detail, setDetail] = useState<DetailedOrder | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!order) { setDetail(null); return; }
    setLoading(true); setDetail(null);
    fetch(`/api/orders/${order.id}`, { cache: "no-store" }).then((response) => response.json()).then((json) => setDetail(json.data ?? null)).finally(() => setLoading(false));
  }, [order]);
  if (!order) return null;
  const field = (key: string) => String(detail?.[key] ?? "待核对");
  const driver = detail?.driverDetail as DriverDetail | null | undefined;
  const phone = field("passengerPhone");
  const pickupAddress = field("pickupAddress");
  const dropoffAddress = field("dropoffAddress");
  return <div className="order-drawer-overlay" role="presentation" onMouseDown={onClose}>
    <aside className="order-drawer" role="dialog" aria-modal="true" aria-label="订单详情侧边栏" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>订单详情</p><h2>{order.orderNo}</h2></div><button type="button" aria-label="关闭订单详情" onClick={onClose}>×</button></header>
      {loading ? <p className="order-drawer-loading">正在读取订单信息…</p> : <div className="order-drawer-body">
        <section><h3>乘客与服务</h3><Row label="乘客" value={field("passengerName")} /><Row label="电话" value={phone} href={phone === "待核对" ? undefined : `tel:${phone.replace(/[^+\d]/g, "")}`} linkLabel="拨打" /><Row label="服务时间" value={detail?.pickupDateTime ? new Date(String(detail.pickupDateTime)).toLocaleString("zh-CN", { timeZone: "Asia/Bangkok" }) : `${order.serviceDate} ${order.pickupTime}`} /><Row label="城市" value={field("city")} /></section>
        <section><h3>行程与车型</h3><Row label="上车地点" value={pickupAddress} href={pickupAddress === "待核对" ? undefined : `https://maps.apple.com/?q=${encodeURIComponent(pickupAddress)}`} linkLabel="地图" /><Row label="下车地点" value={dropoffAddress} href={dropoffAddress === "待核对" ? undefined : `https://maps.apple.com/?q=${encodeURIComponent(dropoffAddress)}`} linkLabel="地图" /><Row label="航班号" value={field("flightNumber")} /><Row label="平台车型" value={field("platformVehicleType")} /></section>
        <section><h3>车队</h3><Row label="派送车队" value={order.fleetName} /></section>
        {driver && <section><h3>司机和车辆信息</h3><Row label="司机姓名" value={driver.confirmedDriverName || "待核对"} /><Row label="司机电话" value={driver.normalizedDriverPhone || "待核对"} href={driver.normalizedDriverPhone ? `tel:${driver.normalizedDriverPhone.replace(/[^+\d]/g, "")}` : undefined} linkLabel="拨打" /><Row label="具体车型" value={driver.confirmedVehicleModel || "待核对"} /><Row label="车牌号" value={driver.licensePlate || "待核对"} /></section>}
      </div>}
      <footer>{onDispatch && <button type="button" className="order-drawer-dispatch" onClick={() => onDispatch(order)}>生成单笔派单</button>}<Link href={`/orders/${order.id}`}>打开完整订单并编辑</Link></footer>
    </aside>
  </div>;
}
function Row({ label, value, href, linkLabel }: { label: string; value: string; href?: string; linkLabel?: string }) {
  const displayValue = value === "null" ? "—" : value;
  return <dl><dt>{label}</dt><dd><span>{displayValue}</span>{href && <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{linkLabel}</a>}</dd></dl>;
}
