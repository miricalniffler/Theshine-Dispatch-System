-- Additive only: copied i'way previews remain auditable after an order
-- cancellation or recovery, but can be marked permanently stale.
ALTER TABLE "IwayReturnBatch"
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "invalidatedReason" TEXT;
