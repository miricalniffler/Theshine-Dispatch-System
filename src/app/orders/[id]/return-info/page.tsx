import { ReturnInfoEditor } from "@/features/iway/ReturnInfoEditor";

export const metadata = { title: "修改回传信息｜接送机发单平台" };

export default async function ReturnInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnInfoEditor orderId={id} />;
}
