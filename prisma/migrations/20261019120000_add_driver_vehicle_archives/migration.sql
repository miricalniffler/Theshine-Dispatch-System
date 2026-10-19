-- Additive-only migration for post-release driver/vehicle archives.
-- No existing Order, DriverDetail or IwayReturnBatchOrder row is rewritten.

ALTER TABLE "DriverDetail"
  ADD COLUMN "driverProfileId" TEXT,
  ADD COLUMN "vehicleProfileId" TEXT,
  ADD COLUMN "thaiDriverName" TEXT,
  ADD COLUMN "driverNameSource" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "iwayDriverName" TEXT;

ALTER TABLE "IwayReturnBatchOrder"
  ADD COLUMN "driverNameSnapshot" TEXT,
  ADD COLUMN "driverNameSourceSnapshot" TEXT;

CREATE TABLE "DriverProfile" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL DEFAULT '无名氏',
  "thaiName" TEXT,
  "confirmedEnglishName" TEXT,
  "nameSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "mergedIntoId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverPhone" (
  "id" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "rawPhone" TEXT NOT NULL,
  "normalizedPhone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverPhone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverNameHistory" (
  "id" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameSource" TEXT NOT NULL,
  "thaiName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverNameHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemporaryDriverName" (
  "id" TEXT NOT NULL,
  "driverProfileId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "generatedName" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "regeneratedAt" TIMESTAMP(3),
  CONSTRAINT "TemporaryDriverName_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleProfile" (
  "id" TEXT NOT NULL,
  "rawLicensePlate" TEXT,
  "normalizedPlate" TEXT,
  "brand" TEXT,
  "vehicleModel" TEXT,
  "photoPath" TEXT,
  "dataSource" TEXT NOT NULL DEFAULT 'MANUAL',
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderDriverVehicleAssignment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "driverProfileId" TEXT,
  "vehicleProfileId" TEXT,
  "driverNameForIway" TEXT,
  "driverNameSource" TEXT NOT NULL DEFAULT 'MANUAL',
  "orderStatus" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  CONSTRAINT "OrderDriverVehicleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverProfileMerge" (
  "id" TEXT NOT NULL,
  "sourceProfileId" TEXT NOT NULL,
  "targetProfileId" TEXT NOT NULL,
  "operator" TEXT,
  "summary" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverProfileMerge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverPhone_normalizedPhone_key" ON "DriverPhone"("normalizedPhone");
CREATE UNIQUE INDEX "TemporaryDriverName_orderId_key" ON "TemporaryDriverName"("orderId");
CREATE UNIQUE INDEX "VehicleProfile_normalizedPlate_key" ON "VehicleProfile"("normalizedPlate");
CREATE INDEX "DriverProfile_displayName_idx" ON "DriverProfile"("displayName");
CREATE INDEX "DriverProfile_mergedIntoId_idx" ON "DriverProfile"("mergedIntoId");
CREATE INDEX "DriverPhone_driverProfileId_idx" ON "DriverPhone"("driverProfileId");
CREATE INDEX "DriverNameHistory_driverProfileId_createdAt_idx" ON "DriverNameHistory"("driverProfileId", "createdAt");
CREATE INDEX "TemporaryDriverName_driverProfileId_createdAt_idx" ON "TemporaryDriverName"("driverProfileId", "createdAt");
CREATE INDEX "VehicleProfile_vehicleModel_idx" ON "VehicleProfile"("vehicleModel");
CREATE INDEX "OrderDriverVehicleAssignment_orderId_isCurrent_idx" ON "OrderDriverVehicleAssignment"("orderId", "isCurrent");
CREATE INDEX "OrderDriverVehicleAssignment_driverProfileId_assignedAt_idx" ON "OrderDriverVehicleAssignment"("driverProfileId", "assignedAt");
CREATE INDEX "OrderDriverVehicleAssignment_vehicleProfileId_assignedAt_idx" ON "OrderDriverVehicleAssignment"("vehicleProfileId", "assignedAt");
CREATE INDEX "DriverProfileMerge_sourceProfileId_createdAt_idx" ON "DriverProfileMerge"("sourceProfileId", "createdAt");
CREATE INDEX "DriverProfileMerge_targetProfileId_createdAt_idx" ON "DriverProfileMerge"("targetProfileId", "createdAt");
CREATE INDEX "DriverDetail_driverProfileId_idx" ON "DriverDetail"("driverProfileId");
CREATE INDEX "DriverDetail_vehicleProfileId_idx" ON "DriverDetail"("vehicleProfileId");

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverPhone" ADD CONSTRAINT "DriverPhone_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverNameHistory" ADD CONSTRAINT "DriverNameHistory_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemporaryDriverName" ADD CONSTRAINT "TemporaryDriverName_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverDetail" ADD CONSTRAINT "DriverDetail_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverDetail" ADD CONSTRAINT "DriverDetail_vehicleProfileId_fkey" FOREIGN KEY ("vehicleProfileId") REFERENCES "VehicleProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderDriverVehicleAssignment" ADD CONSTRAINT "OrderDriverVehicleAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderDriverVehicleAssignment" ADD CONSTRAINT "OrderDriverVehicleAssignment_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderDriverVehicleAssignment" ADD CONSTRAINT "OrderDriverVehicleAssignment_vehicleProfileId_fkey" FOREIGN KEY ("vehicleProfileId") REFERENCES "VehicleProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverProfileMerge" ADD CONSTRAINT "DriverProfileMerge_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverProfileMerge" ADD CONSTRAINT "DriverProfileMerge_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
