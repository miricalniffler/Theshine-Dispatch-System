-- AI suggestions remain non-authoritative until a human explicitly chooses a
-- one-order confirmation or creates a separately auditable long-term rule.
ALTER TABLE "AiVehicleCandidate"
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewAction" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewNote" TEXT,
  ADD COLUMN IF NOT EXISTS "resolvedName" TEXT,
  ADD COLUMN IF NOT EXISTS "appliedOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleStandardId" TEXT;

CREATE INDEX IF NOT EXISTS "AiVehicleCandidate_status_createdAt_idx" ON "AiVehicleCandidate"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AiVehicleCandidate_appliedOrderId_idx" ON "AiVehicleCandidate"("appliedOrderId");

CREATE TABLE IF NOT EXISTS "VehicleStandardAudit" (
  "id" TEXT NOT NULL,
  "vehicleStandardId" TEXT NOT NULL,
  "aiCandidateId" TEXT,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleStandardAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VehicleStandardAudit_vehicleStandardId_fkey" FOREIGN KEY ("vehicleStandardId") REFERENCES "VehicleModelStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "VehicleStandardAudit_vehicleStandardId_createdAt_idx" ON "VehicleStandardAudit"("vehicleStandardId", "createdAt");
CREATE INDEX IF NOT EXISTS "VehicleStandardAudit_aiCandidateId_idx" ON "VehicleStandardAudit"("aiCandidateId");
