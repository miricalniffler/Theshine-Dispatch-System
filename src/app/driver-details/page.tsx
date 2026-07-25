import { Suspense } from "react";
import { FleetReplyWorkspace } from "@/features/fleet-replies/fleet-reply-workspace";
export const metadata = { title: "车队回传信息｜接送机发单平台" };
export default function DriverDetailsPage() { return <Suspense fallback={<main className="workflow-page"><p className="loading">正在打开车队回传信息…</p></main>}><FleetReplyWorkspace /></Suspense>; }
