-- Additive Phase II migration. It does not change existing orders, users, or
-- production data; applying it requires the normal reviewed deployment flow.
ALTER TABLE "DriverDetail"
  ADD COLUMN "driverNameSource" TEXT,
  ADD COLUMN "driverNameSourceDetail" TEXT;

CREATE TABLE "VehicleArchive" (
  "id" TEXT NOT NULL,
  "normalizedPlate" TEXT NOT NULL,
  "rawPlate" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "vehicleClass" TEXT,
  "confirmationStatus" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "source" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleArchive_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleArchiveDriver" (
  "id" TEXT NOT NULL,
  "vehicleArchiveId" TEXT NOT NULL,
  "driverName" TEXT,
  "normalizedPhone" TEXT,
  "source" TEXT NOT NULL,
  "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleArchiveDriver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleArchiveHistory" (
  "id" TEXT NOT NULL,
  "vehicleArchiveId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "snapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleArchiveHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleArchive_normalizedPlate_key" ON "VehicleArchive"("normalizedPlate");
CREATE INDEX "VehicleArchive_confirmationStatus_updatedAt_idx" ON "VehicleArchive"("confirmationStatus", "updatedAt");
CREATE INDEX "VehicleArchiveDriver_vehicleArchiveId_lastSeenAt_idx" ON "VehicleArchiveDriver"("vehicleArchiveId", "lastSeenAt");
CREATE INDEX "VehicleArchiveDriver_normalizedPhone_idx" ON "VehicleArchiveDriver"("normalizedPhone");
CREATE INDEX "VehicleArchiveHistory_vehicleArchiveId_createdAt_idx" ON "VehicleArchiveHistory"("vehicleArchiveId", "createdAt");

ALTER TABLE "VehicleArchiveDriver" ADD CONSTRAINT "VehicleArchiveDriver_vehicleArchiveId_fkey"
  FOREIGN KEY ("vehicleArchiveId") REFERENCES "VehicleArchive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleArchiveHistory" ADD CONSTRAINT "VehicleArchiveHistory_vehicleArchiveId_fkey"
  FOREIGN KEY ("vehicleArchiveId") REFERENCES "VehicleArchive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
