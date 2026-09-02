-- CreateTable
CREATE TABLE "AirportGuide" (
    "id" TEXT NOT NULL,
    "airportName" TEXT NOT NULL,
    "iataCode" TEXT,
    "terminal" TEXT,
    "matchKey" TEXT NOT NULL,
    "guideText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirportGuideAlias" (
    "id" TEXT NOT NULL,
    "airportGuideId" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL DEFAULT 'ALIAS',
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirportGuideAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirportGuideImage" (
    "id" TEXT NOT NULL,
    "airportGuideId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirportGuideImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionNotificationSetting" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "customerWhatsAppEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "contentSnapshot" JSONB,
    "templateSnapshot" JSONB,
    "driverVehicleSnapshot" JSONB,
    "airportGuideSnapshot" JSONB,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AirportGuide_iataCode_isActive_idx" ON "AirportGuide"("iataCode", "isActive");
CREATE INDEX "AirportGuide_isActive_updatedAt_idx" ON "AirportGuide"("isActive", "updatedAt");
CREATE INDEX "AirportGuide_matchKey_idx" ON "AirportGuide"("matchKey");
CREATE UNIQUE INDEX "AirportGuide_matchKey_active_unique" ON "AirportGuide"("matchKey") WHERE "isActive" = true;
CREATE UNIQUE INDEX "AirportGuideAlias_airportGuideId_matchKind_normalizedValue_key" ON "AirportGuideAlias"("airportGuideId", "matchKind", "normalizedValue");
CREATE INDEX "AirportGuideAlias_matchKind_normalizedValue_idx" ON "AirportGuideAlias"("matchKind", "normalizedValue");
CREATE UNIQUE INDEX "AirportGuideImage_storageBucket_storagePath_key" ON "AirportGuideImage"("storageBucket", "storagePath");
CREATE INDEX "AirportGuideImage_airportGuideId_sortOrder_idx" ON "AirportGuideImage"("airportGuideId", "sortOrder");
CREATE UNIQUE INDEX "RegionNotificationSetting_region_key" ON "RegionNotificationSetting"("region");
CREATE UNIQUE INDEX "CustomerNotification_idempotencyKey_key" ON "CustomerNotification"("idempotencyKey");
CREATE UNIQUE INDEX "CustomerNotification_providerMessageId_key" ON "CustomerNotification"("providerMessageId");
CREATE INDEX "CustomerNotification_orderId_notificationType_createdAt_idx" ON "CustomerNotification"("orderId", "notificationType", "createdAt");
CREATE INDEX "CustomerNotification_status_createdAt_idx" ON "CustomerNotification"("status", "createdAt");
CREATE INDEX "CustomerNotification_recipientPhone_createdAt_idx" ON "CustomerNotification"("recipientPhone", "createdAt");

-- AddForeignKey
ALTER TABLE "AirportGuideAlias" ADD CONSTRAINT "AirportGuideAlias_airportGuideId_fkey" FOREIGN KEY ("airportGuideId") REFERENCES "AirportGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AirportGuideImage" ADD CONSTRAINT "AirportGuideImage_airportGuideId_fkey" FOREIGN KEY ("airportGuideId") REFERENCES "AirportGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed only the initial operational defaults. Business code always reads the table;
-- any future region without a record remains safely disabled until configured.
INSERT INTO "RegionNotificationSetting" ("id", "region", "customerWhatsAppEnabled", "createdAt", "updatedAt")
VALUES
  ('region-notification-bangkok', '曼谷', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('region-notification-samui', '苏梅', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("region") DO NOTHING;
