import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "接送机发单平台", description: "内部运营工作台" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
