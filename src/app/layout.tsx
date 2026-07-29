import type { Metadata } from "next";
import { AppNavigation } from "@/components/AppNavigation";
import { PwaRegistration } from "@/components/PwaRegistration";
import "./styles.css";

export const metadata: Metadata = {
  title: "接送机发单平台",
  description: "内部运营工作台",
  icons: {
    icon: "/iway-logo.png",
    apple: "/iway-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><PwaRegistration /><AppNavigation>{children}</AppNavigation></body></html>;
}
