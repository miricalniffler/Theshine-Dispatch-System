"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavLink = { href: string; defaultLabel: string };

const defaultLinks: NavLink[] = [
  { href: "/orders", defaultLabel: "订单" },
  { href: "/driver-details", defaultLabel: "车队回传" },
  { href: "/fleets", defaultLabel: "车队管理" },
  { href: "/history-orders", defaultLabel: "历史订单" },
  { href: "/rules", defaultLabel: "设置 / 规则" },
];

const storageKey = "iway-navigation-preferences-v1";

export function AppNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [order, setOrder] = useState(() => defaultLinks.map((link) => link.href));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editingHref, setEditingHref] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draggingHref, setDraggingHref] = useState<string | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
      if (Array.isArray(saved.order)) {
        const known = saved.order.filter((href: unknown): href is string => typeof href === "string" && defaultLinks.some((link) => link.href === href));
        const missing = defaultLinks.map((link) => link.href).filter((href) => !known.includes(href));
        setOrder([...known, ...missing]);
      }
      if (saved.labels && typeof saved.labels === "object") setLabels(saved.labels as Record<string, string>);
    } catch { /* 首次使用或旧设置异常时，使用默认菜单。 */ }
  }, []);

  useEffect(() => { window.localStorage.setItem(storageKey, JSON.stringify({ order, labels })); }, [order, labels]);

  const links = useMemo(() => order.map((href) => defaultLinks.find((link) => link.href === href)).filter((link): link is NavLink => Boolean(link)), [order]);
  const labelFor = (link: NavLink) => labels[link.href]?.trim() || link.defaultLabel;
  const beginRename = (link: NavLink) => { setEditingHref(link.href); setDraftLabel(labelFor(link)); };
  const saveRename = (link: NavLink) => {
    const next = draftLabel.trim();
    setLabels((current) => ({ ...current, [link.href]: next && next !== link.defaultLabel ? next : "" }));
    setEditingHref(null);
  };
  const moveLink = (from: string, to: string) => {
    if (from === to) return;
    setOrder((current) => {
      const next = [...current];
      const fromIndex = next.indexOf(from);
      const toIndex = next.indexOf(to);
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  };
  async function signOut() {
    if ("caches" in window) {
      const cacheKeys = await window.caches.keys().catch(() => []);
      await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    }
    await fetch("/api/access/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  return <div className="app-frame">
    <aside className="app-nav" aria-label="主导航">
      <Link href="/orders" className="app-brand"><img src="/iway-logo.png" alt="I’WAY 标志" /><span>接送机工作台<small>订单处理与车队协作</small></span></Link>
      <nav className="custom-nav">
        {links.map((link) => {
          const active = pathname === link.href;
          const editing = editingHref === link.href;
          return <div key={link.href} className={`nav-item nav-${link.href.slice(1).replace(/[^a-z0-9]/g, "-")}${active ? " active" : ""}${draggingHref === link.href ? " dragging" : ""}`} draggable={!editing} onDragStart={() => setDraggingHref(link.href)} onDragEnd={() => setDraggingHref(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingHref) moveLink(draggingHref, link.href); setDraggingHref(null); }}>
            <span className="nav-drag-handle" aria-hidden="true" title="拖动调整位置">⠿</span>
            {editing ? <input autoFocus value={draftLabel} maxLength={24} aria-label={`重命名 ${link.defaultLabel}`} onChange={(event) => setDraftLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(link); if (event.key === "Escape") setEditingHref(null); }} onBlur={() => saveRename(link)} /> : <Link href={link.href} onClick={(event) => { if (active) { event.preventDefault(); beginRename(link); } }}>{labelFor(link)}</Link>}
          </div>;
        })}
        <button className="mobile-more-trigger" type="button" onClick={() => setMobileMoreOpen(true)} aria-label="打开更多功能">更多</button>
      </nav>
      <p className="nav-customize-tip">拖动 ⠿ 调整顺序；再次点击当前标签可改名。</p>
      <div className="app-nav-note"><span>人工发送模式</span>微信与 WhatsApp 只生成、复制，不会自动发送。</div>
    </aside>
    <div className="app-content">{children}</div>
    {mobileMoreOpen && <div className="mobile-more-overlay" role="presentation" onMouseDown={() => setMobileMoreOpen(false)}>
      <section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="更多功能" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>接送机工作台</small><h2>更多功能</h2></div><button type="button" onClick={() => setMobileMoreOpen(false)} aria-label="关闭更多功能">×</button></header>
        <div className="mobile-more-links">{links.map((link, index) => <div key={link.href} className="mobile-more-link"><Link href={link.href} onClick={() => setMobileMoreOpen(false)}>{labelFor(link)}</Link><div><button type="button" disabled={index === 0} onClick={() => moveLink(link.href, links[index - 1].href)} aria-label={`上移 ${labelFor(link)}`}>↑</button><button type="button" disabled={index === links.length - 1} onClick={() => moveLink(link.href, links[index + 1].href)} aria-label={`下移 ${labelFor(link)}`}>↓</button></div></div>)}</div>
        <p>再次点击当前页面标签即可重命名；这里可用上下按钮调整手机菜单顺序。</p>
        <button className="mobile-sign-out" type="button" onClick={() => void signOut()}>退出当前设备</button>
      </section>
    </div>}
  </div>;
}
