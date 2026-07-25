"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/orders", label: "订单工作台" },
  { href: "/driver-details", label: "车队回传信息" },
  { href: "/fleets", label: "车队管理" },
  { href: "/rules", label: "规则中心" },
];

export function AppNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="app-frame">
    <aside className="app-nav" aria-label="主导航">
      <Link href="/orders" className="app-brand">接送机工作台<small>MVP 交互原型 · 批量操作 v3</small></Link>
      <nav>{links.map((link) => { const active = pathname === link.href; return <Link key={`${link.href}-${link.label}`} href={link.href} className={active ? "active" : ""}>{link.label}</Link>; })}</nav>
      <div className="app-nav-note"><span>人工发送模式</span>微信与 WhatsApp 只生成、复制，不会自动发送。</div>
    </aside>
    <div className="app-content">{children}</div>
  </div>;
}
