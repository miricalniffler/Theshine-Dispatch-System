import { redirect } from "next/navigation";

export const metadata = { title: "导入订单｜接送机发单平台" };

// Keep old bookmarks safe: importing now happens through the single
// “同步飞书并刷新” action on the order workbench.
export default function ImportPage() { redirect("/orders"); }
