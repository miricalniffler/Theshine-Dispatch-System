-- Additive migration only: it neither changes historical orders nor touches
-- the existing VehicleCapacityRule table.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "luggageSource" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "serviceCountry" TEXT;

CREATE TABLE "VehicleModelStandard" (
  "id" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "internalGrade" TEXT NOT NULL,
  "configurationLabel" TEXT, "representativeModels" JSONB NOT NULL, "normalizedName" TEXT,
  "brand" TEXT, "model" TEXT, "vehicleCategory" TEXT, "totalSeats" INTEGER,
  "maxPassengers" INTEGER NOT NULL, "maxStandardLuggage" INTEGER NOT NULL,
  "countryScopeKey" TEXT NOT NULL DEFAULT 'GLOBAL', "countryScopeLabel" TEXT,
  "luxury" BOOLEAN, "source" TEXT NOT NULL, "sourceReference" TEXT,
  "originalRecord" JSONB NOT NULL, "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "VehicleModelStandard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleModelStandard_sourceKey_key" ON "VehicleModelStandard"("sourceKey");
CREATE INDEX "VehicleModelStandard_internalGrade_countryScopeKey_idx" ON "VehicleModelStandard"("internalGrade", "countryScopeKey");
CREATE INDEX "VehicleModelStandard_normalizedName_idx" ON "VehicleModelStandard"("normalizedName");

CREATE TABLE "VehicleModelStandardAlias" (
  "id" TEXT NOT NULL, "vehicleStandardId" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleModelStandardAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VehicleModelStandardAlias_vehicleStandardId_fkey" FOREIGN KEY ("vehicleStandardId") REFERENCES "VehicleModelStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VehicleModelStandardAlias_vehicleStandardId_normalizedName_key" ON "VehicleModelStandardAlias"("vehicleStandardId", "normalizedName");
CREATE INDEX "VehicleModelStandardAlias_normalizedName_idx" ON "VehicleModelStandardAlias"("normalizedName");

CREATE TABLE "VehicleCapacityCombination" (
  "id" TEXT NOT NULL, "vehicleStandardId" TEXT NOT NULL, "passengers" INTEGER NOT NULL,
  "standardLuggage" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "downwardCompatible" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL, "sourceReference" TEXT, "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleCapacityCombination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VehicleCapacityCombination_vehicleStandardId_fkey" FOREIGN KEY ("vehicleStandardId") REFERENCES "VehicleModelStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VehicleCapacityCombination_vehicleStandardId_passengers_standardLuggage_key" ON "VehicleCapacityCombination"("vehicleStandardId", "passengers", "standardLuggage");

CREATE TABLE "PlatformVehicleGradeRule" (
  "id" TEXT NOT NULL, "platform" TEXT NOT NULL, "countryScopeKey" TEXT NOT NULL,
  "countryScopeLabel" TEXT, "platformGrade" TEXT NOT NULL, "vehicleStandardId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL, "source" TEXT NOT NULL, "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlatformVehicleGradeRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformVehicleGradeRule_vehicleStandardId_fkey" FOREIGN KEY ("vehicleStandardId") REFERENCES "VehicleModelStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PlatformVehicleGradeRule_platform_countryScopeKey_platformGrade_idx" ON "PlatformVehicleGradeRule"("platform", "countryScopeKey", "platformGrade");

CREATE TABLE "OrderVehicleAssessment" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "status" TEXT NOT NULL, "reason" TEXT,
  "inputSnapshot" JSONB NOT NULL, "resultSnapshot" JSONB NOT NULL, "standardVersion" TEXT,
  "fingerprint" TEXT NOT NULL, "trigger" TEXT NOT NULL, "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "invalidatedAt" TIMESTAMP(3),
  CONSTRAINT "OrderVehicleAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderVehicleAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderVehicleAssessment_orderId_isCurrent_idx" ON "OrderVehicleAssessment"("orderId", "isCurrent");
CREATE INDEX "OrderVehicleAssessment_fingerprint_idx" ON "OrderVehicleAssessment"("fingerprint");

CREATE TABLE "OrderVehicleOverride" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "reason" TEXT NOT NULL, "inputSnapshot" JSONB NOT NULL,
  "assessmentId" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidatedAt" TIMESTAMP(3), CONSTRAINT "OrderVehicleOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderVehicleOverride_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderVehicleOverride_orderId_isActive_idx" ON "OrderVehicleOverride"("orderId", "isActive");

CREATE TABLE "AiVehicleCandidate" (
  "id" TEXT NOT NULL, "cacheKey" TEXT NOT NULL, "requestSnapshot" JSONB NOT NULL,
  "candidates" JSONB NOT NULL, "provider" TEXT NOT NULL, "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3),
  CONSTRAINT "AiVehicleCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiVehicleCandidate_cacheKey_key" ON "AiVehicleCandidate"("cacheKey");
