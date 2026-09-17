import { ConfirmationDetail } from "@/components/confirmation-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  return <ConfirmationDetail callId={callId} />;
}
