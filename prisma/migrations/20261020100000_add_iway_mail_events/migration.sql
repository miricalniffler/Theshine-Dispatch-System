-- Additive mail-event audit tables only. Existing orders and imported messages
-- are not altered, backfilled, or replayed by this migration.
CREATE TABLE "IwayMailEvent" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "sender" TEXT,
  "subject" TEXT,
  "eventType" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "orderId" TEXT,
  "eventAt" TIMESTAMP(3),
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IwayMailEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IwayMailEvent_externalId_key" ON "IwayMailEvent"("externalId");
CREATE INDEX "IwayMailEvent_orderId_eventAt_idx" ON "IwayMailEvent"("orderId", "eventAt");
CREATE INDEX "IwayMailEvent_eventType_disposition_createdAt_idx" ON "IwayMailEvent"("eventType", "disposition", "createdAt");
ALTER TABLE "IwayMailEvent" ADD CONSTRAINT "IwayMailEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IwayCancellationCase" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "mailEventId" TEXT NOT NULL,
  "previousStatus" TEXT NOT NULL,
  "cancellationReason" TEXT,
  "mailReceivedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fleetNotificationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  "fleetNotifiedAt" TIMESTAMP(3),
  "fleetNotifiedBy" TEXT,
  "assignmentSnapshot" TEXT,
  "restoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IwayCancellationCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IwayCancellationCase_mailEventId_key" ON "IwayCancellationCase"("mailEventId");
CREATE INDEX "IwayCancellationCase_orderId_processedAt_idx" ON "IwayCancellationCase"("orderId", "processedAt");
CREATE INDEX "IwayCancellationCase_fleetNotificationStatus_createdAt_idx" ON "IwayCancellationCase"("fleetNotificationStatus", "createdAt");
ALTER TABLE "IwayCancellationCase" ADD CONSTRAINT "IwayCancellationCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IwayCancellationCase" ADD CONSTRAINT "IwayCancellationCase_mailEventId_fkey" FOREIGN KEY ("mailEventId") REFERENCES "IwayMailEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "IwayChangeDraft" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "mailEventId" TEXT NOT NULL,
  "changes" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  CONSTRAINT "IwayChangeDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IwayChangeDraft_mailEventId_key" ON "IwayChangeDraft"("mailEventId");
CREATE INDEX "IwayChangeDraft_orderId_status_createdAt_idx" ON "IwayChangeDraft"("orderId", "status", "createdAt");
ALTER TABLE "IwayChangeDraft" ADD CONSTRAINT "IwayChangeDraft_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IwayChangeDraft" ADD CONSTRAINT "IwayChangeDraft_mailEventId_fkey" FOREIGN KEY ("mailEventId") REFERENCES "IwayMailEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
