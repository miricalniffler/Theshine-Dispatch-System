/**
 * Transport boundary for the future Meta Cloud API implementation.
 * The current transport deliberately does not make a network request and does
 * not claim that a customer received anything.
 */
export type CustomerNotificationTransportResult = {
  status: "PENDING";
  provider: "INTERNAL";
  message: string;
};

export interface CustomerNotificationTransport {
  name: string;
  prepare(notificationId: string): Promise<CustomerNotificationTransportResult>;
}

export const internalPendingTransport: CustomerNotificationTransport = {
  name: "internal-pending",
  async prepare() {
    return { status: "PENDING", provider: "INTERNAL", message: "内容已生成为内部待发送记录；尚未调用 WhatsApp 或 Meta。" };
  },
};
