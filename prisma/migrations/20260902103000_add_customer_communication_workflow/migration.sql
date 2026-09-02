-- Phase 2 internal customer-communication facts.  This is additive only: no
-- existing order or i’way field is renamed, removed, or reinterpreted.
ALTER TABLE "Order"
  ADD COLUMN "customerConfirmationStatus" TEXT,
  ADD COLUMN "customerConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "customerLargeLuggageCount" INTEGER,
  ADD COLUMN "customerCarryOnCount" INTEGER,
  ADD COLUMN "customerStrollerCount" INTEGER,
  ADD COLUMN "customerBulkyItems" TEXT,
  ADD COLUMN "customerLuggageUpdatedAt" TIMESTAMP(3);

CREATE TABLE "CustomerInboundMessage" (
  "id" TEXT NOT NULL,
  "orderId" TEXT,
  "customerNotificationId" TEXT,
  "senderPhone" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "rawText" TEXT NOT NULL,
  "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "parsedSnapshot" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerInboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerCommunicationException" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "exceptionType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'WARNING',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "idempotencyKey" TEXT NOT NULL,
  "details" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerCommunicationException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleCapacityRule" (
  "id" TEXT NOT NULL,
  "vehicleModel" TEXT NOT NULL,
  "normalizedVehicleModel" TEXT NOT NULL,
  "maxPassengers" INTEGER,
  "normalLargeLuggage" INTEGER,
  "warningLargeLuggage" INTEGER,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleCapacityRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerInboundMessage_providerMessageId_key" ON "CustomerInboundMessage"("providerMessageId");
CREATE INDEX "CustomerInboundMessage_orderId_receivedAt_idx" ON "CustomerInboundMessage"("orderId", "receivedAt");
CREATE INDEX "CustomerInboundMessage_senderPhone_receivedAt_idx" ON "CustomerInboundMessage"("senderPhone", "receivedAt");
CREATE UNIQUE INDEX "CustomerCommunicationException_idempotencyKey_key" ON "CustomerCommunicationException"("idempotencyKey");
CREATE INDEX "CustomerCommunicationException_orderId_status_createdAt_idx" ON "CustomerCommunicationException"("orderId", "status", "createdAt");
CREATE INDEX "CustomerCommunicationException_status_severity_createdAt_idx" ON "CustomerCommunicationException"("status", "severity", "createdAt");
CREATE UNIQUE INDEX "VehicleCapacityRule_vehicleModel_key" ON "VehicleCapacityRule"("vehicleModel");
CREATE UNIQUE INDEX "VehicleCapacityRule_normalizedVehicleModel_key" ON "VehicleCapacityRule"("normalizedVehicleModel");
CREATE INDEX "VehicleCapacityRule_isActive_normalizedVehicleModel_idx" ON "VehicleCapacityRule"("isActive", "normalizedVehicleModel");
CREATE INDEX "Order_customerConfirmationStatus_idx" ON "Order"("customerConfirmationStatus");

ALTER TABLE "CustomerInboundMessage" ADD CONSTRAINT "CustomerInboundMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerInboundMessage" ADD CONSTRAINT "CustomerInboundMessage_customerNotificationId_fkey" FOREIGN KEY ("customerNotificationId") REFERENCES "CustomerNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerCommunicationException" ADD CONSTRAINT "CustomerCommunicationException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
