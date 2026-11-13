CREATE TABLE "MailOperationMessage" (
  "id" TEXT NOT NULL, "gmailMessageId" TEXT NOT NULL, "gmailThreadId" TEXT,
  "sender" TEXT NOT NULL, "subject" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL,
  "bodyText" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'OTHER', "status" TEXT NOT NULL DEFAULT 'OPEN',
  "city" TEXT, "orderId" TEXT, "extracted" JSONB, "analysis" JSONB, "draftReply" TEXT,
  "draftUpdatedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "sentMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailOperationMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailOperationMessage_gmailMessageId_key" ON "MailOperationMessage"("gmailMessageId");
CREATE INDEX "MailOperationMessage_status_category_receivedAt_idx" ON "MailOperationMessage"("status", "category", "receivedAt");
CREATE INDEX "MailOperationMessage_orderId_receivedAt_idx" ON "MailOperationMessage"("orderId", "receivedAt");
CREATE INDEX "MailOperationMessage_gmailThreadId_idx" ON "MailOperationMessage"("gmailThreadId");
ALTER TABLE "MailOperationMessage" ADD CONSTRAINT "MailOperationMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MailOperationEvent" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "action" TEXT NOT NULL, "actor" TEXT NOT NULL,
  "details" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailOperationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MailOperationEvent_messageId_createdAt_idx" ON "MailOperationEvent"("messageId", "createdAt");
ALTER TABLE "MailOperationEvent" ADD CONSTRAINT "MailOperationEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailOperationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuoteRule" (
  "id" TEXT NOT NULL, "city" TEXT NOT NULL, "routeKey" TEXT NOT NULL, "vehicleType" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'MYR', "baseCost" DECIMAL(12,2), "marginRate" DECIMAL(6,4),
  "surcharge" DECIMAL(12,2), "note" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuoteRule_city_routeKey_isActive_idx" ON "QuoteRule"("city", "routeKey", "isActive");

CREATE TABLE "WebPushSubscription" (
  "id" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");
