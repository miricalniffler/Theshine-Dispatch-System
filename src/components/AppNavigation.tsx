"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavLink = { href: string; defaultLabel: string };

const defaultLinks: NavLink[] = [
  { href: "/orders", defaultLabel: "订单工作台" },
  { href: "/history-orders", defaultLabel: "历史订单" },
  { href: "/fleets", defaultLabel: "车队管理" },
  { href: "/driver-details", defaultLabel: "车队回传信息" },
  { href: "/iway-return", defaultLabel: "i’way 回传" },
  { href: "/rules", defaultLabel: "规则中心" },
];

const storageKey = "iway-navigation-preferences-v1";

export function AppNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [order, setOrder] = useState(() => defaultLinks.map((link) => link.href));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editingHref, setEditingHref] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draggingHref, setDraggingHref] = useState<string | null>(null);

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

  return <div className="app-frame">
    <aside className="app-nav" aria-label="主导航">
      <Link href="/orders" className="app-brand"><img src="/iway-logo.png" alt="I’WAY 标志" /><span>接送机工作台<small>订单处理与车队协作</small></span></Link>
      <nav className="custom-nav">
        {links.map((link) => {
          const active = pathname === link.href;
          const editing = editingHref === link.href;
          return <div key={link.href} className={`nav-item${active ? " active" : ""}${draggingHref === link.href ? " dragging" : ""}`} draggable={!editing} onDragStart={() => setDraggingHref(link.href)} onDragEnd={() => setDraggingHref(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingHref) moveLink(draggingHref, link.href); setDraggingHref(null); }}>
            <span className="nav-drag-handle" aria-hidden="true" title="拖动调整位置">⠿</span>
            {editing ? <input autoFocus value={draftLabel} maxLength={24} aria-label={`重命名 ${link.defaultLabel}`} onChange={(event) => setDraftLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(link); if (event.key === "Escape") setEditingHref(null); }} onBlur={() => saveRename(link)} /> : <Link href={link.href} onClick={(event) => { if (active) { event.preventDefault(); beginRename(link); } }}>{labelFor(link)}</Link>}
          </div>;
        })}
      </nav>
      <p className="nav-customize-tip">拖动 ⠿ 调整顺序；再次点击当前标签可改名。</p>
      <div className="app-nav-note"><span>人工发送模式</span>微信与 WhatsApp 只生成、复制，不会自动发送。</div>
    </aside>
    <div className="app-content">{children}</div>
  </div>;
}
