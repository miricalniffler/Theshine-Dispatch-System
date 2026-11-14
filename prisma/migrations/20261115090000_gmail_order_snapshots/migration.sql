-- Additive only: existing orders, source messages and audit history are never
-- modified or deleted by this migration.
CREATE TABLE "GmailOrderSnapshot" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceMessageExternalId" TEXT,
  "kind" TEXT NOT NULL,
  "beforeState" JSONB NOT NULL,
  "afterState" JSONB NOT NULL,
  "changedFields" JSONB NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3),
  "rollbackSnapshotId" TEXT,
  CONSTRAINT "GmailOrderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmailOrderSnapshot_sourceMessageExternalId_key" ON "GmailOrderSnapshot"("sourceMessageExternalId");
CREATE INDEX "GmailOrderSnapshot_orderId_appliedAt_idx" ON "GmailOrderSnapshot"("orderId", "appliedAt");
CREATE INDEX "GmailOrderSnapshot_kind_appliedAt_idx" ON "GmailOrderSnapshot"("kind", "appliedAt");
ALTER TABLE "GmailOrderSnapshot" ADD CONSTRAINT "GmailOrderSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
