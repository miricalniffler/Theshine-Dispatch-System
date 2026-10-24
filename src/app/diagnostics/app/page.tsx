import { DiagnosticClient } from "./DiagnosticClient";

export const metadata = { title: "手机应用诊断｜接送机发单平台" };

/** Uses the normal Next root layout but deliberately avoids order components and APIs. */
export default function AppDiagnosticPage() {
  return <main className="diagnostic-page"><p className="eyebrow">MOBILE DIAGNOSTIC</p><h1>应用启动诊断</h1><p>如果此页可显示、但订单页白屏，问题更可能发生在订单模块；若此页也白屏，则可继续定位到应用布局、客户端启动或浏览器缓存。</p><DiagnosticClient /></main>;
}
