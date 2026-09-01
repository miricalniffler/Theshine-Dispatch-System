import { Suspense } from "react";
import { IwayReturnWorkspace } from "@/features/iway/driver-workspace";

export const metadata = { title: "i’way 回传｜接送机发单平台" };

export default function IwayReturnPage() { return <Suspense fallback={<main className="workflow-page"><p className="loading">正在打开 i’way 回传…</p></main>}><IwayReturnWorkspace /></Suspense>; }
