-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "platformOrderNumber" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "fleetId" TEXT,
    "serviceDate" TEXT NOT NULL,
    "pickupDateTime" TIMESTAMP(3) NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "passengerName" TEXT NOT NULL,
    "passengerPhone" TEXT NOT NULL,
    "flightNumber" TEXT,
    "platformVehicleType" TEXT NOT NULL,
    "seatCount" INTEGER,
    "adults" INTEGER NOT NULL DEFAULT 0,
    "children" INTEGER NOT NULL DEFAULT 0,
    "luggage" INTEGER NOT NULL DEFAULT 0,
    "childSeatLine" TEXT,
    "meetGreetLine" TEXT,
    "otherNotes" TEXT,
    "rawSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_DISPATCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Fleet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DriverDetail" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "confirmedDriverName" TEXT,
    "rawDriverPhone" TEXT,
    "normalizedDriverPhone" TEXT,
    "confirmedVehicleModel" TEXT,
    "licensePlate" TEXT,
    "rawReply" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DispatchBatch" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "copiedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FleetReply" (
    "id" TEXT NOT NULL,
    "dispatchBatchId" TEXT,
    "candidateOrderIds" TEXT,
    "rawText" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FleetReplyImage" (
    "id" TEXT NOT NULL,
    "fleetReplyId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetReplyImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AiExtraction" (
    "id" TEXT NOT NULL,
    "fleetReplyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT,
    "promptVersion" TEXT NOT NULL,
    "rawModelJson" TEXT,
    "validatedResultJson" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DriverDetailConfirmation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fleetReplyId" TEXT NOT NULL,
    "extractionId" TEXT,
    "finalDriverName" TEXT NOT NULL,
    "finalPhone" TEXT NOT NULL,
    "finalPlate" TEXT NOT NULL,
    "finalVehicleModel" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rulesVersion" TEXT NOT NULL,

    CONSTRAINT "DriverDetailConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DispatchBatchOrder" (
    "dispatchBatchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "DispatchBatchOrder_pkey" PRIMARY KEY ("dispatchBatchId","orderId")
);

-- CreateTable
CREATE TABLE "public"."IwayReturnBatch" (
    "id" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "copiedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IwayReturnBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IwayReturnBatchOrder" (
    "iwayReturnBatchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "IwayReturnBatchOrder_pkey" PRIMARY KEY ("iwayReturnBatchId","orderId")
);

-- CreateTable
CREATE TABLE "public"."RuleVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "yamlContent" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActivityLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DuplicateReview" (
    "id" TEXT NOT NULL,
    "incomingKey" TEXT NOT NULL,
    "candidateOrder" TEXT,
    "decision" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportSyncRun" (
    "id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ImportSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportedSourceMessage" (
    "id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedSourceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_platformOrderNumber_key" ON "public"."Order"("platformOrderNumber");

-- CreateIndex
CREATE INDEX "Order_serviceDate_city_fleetId_idx" ON "public"."Order"("serviceDate", "city", "fleetId");

-- CreateIndex
CREATE INDEX "Order_status_pickupDateTime_idx" ON "public"."Order"("status", "pickupDateTime");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_name_city_key" ON "public"."Fleet"("name", "city");

-- CreateIndex
CREATE UNIQUE INDEX "DriverDetail_orderId_key" ON "public"."DriverDetail"("orderId");

-- CreateIndex
CREATE INDEX "DispatchBatch_serviceDate_city_fleetId_idx" ON "public"."DispatchBatch"("serviceDate", "city", "fleetId");

-- CreateIndex
CREATE INDEX "FleetReply_dispatchBatchId_createdAt_idx" ON "public"."FleetReply"("dispatchBatchId", "createdAt");

-- CreateIndex
CREATE INDEX "FleetReplyImage_fleetReplyId_idx" ON "public"."FleetReplyImage"("fleetReplyId");

-- CreateIndex
CREATE INDEX "AiExtraction_fleetReplyId_createdAt_idx" ON "public"."AiExtraction"("fleetReplyId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverDetailConfirmation_orderId_confirmedAt_idx" ON "public"."DriverDetailConfirmation"("orderId", "confirmedAt");

-- CreateIndex
CREATE INDEX "DriverDetailConfirmation_fleetReplyId_idx" ON "public"."DriverDetailConfirmation"("fleetReplyId");

-- CreateIndex
CREATE INDEX "IwayReturnBatch_serviceDate_idx" ON "public"."IwayReturnBatch"("serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVersion_version_key" ON "public"."RuleVersion"("version");

-- CreateIndex
CREATE INDEX "ActivityLog_orderId_createdAt_idx" ON "public"."ActivityLog"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "DuplicateReview_incomingKey_idx" ON "public"."DuplicateReview"("incomingKey");

-- CreateIndex
CREATE INDEX "ImportSyncRun_connector_startedAt_idx" ON "public"."ImportSyncRun"("connector", "startedAt");

-- CreateIndex
CREATE INDEX "ImportedSourceMessage_orderId_idx" ON "public"."ImportedSourceMessage"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedSourceMessage_connector_externalId_key" ON "public"."ImportedSourceMessage"("connector", "externalId");

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "public"."Fleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverDetail" ADD CONSTRAINT "DriverDetail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DispatchBatch" ADD CONSTRAINT "DispatchBatch_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "public"."Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FleetReply" ADD CONSTRAINT "FleetReply_dispatchBatchId_fkey" FOREIGN KEY ("dispatchBatchId") REFERENCES "public"."DispatchBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FleetReplyImage" ADD CONSTRAINT "FleetReplyImage_fleetReplyId_fkey" FOREIGN KEY ("fleetReplyId") REFERENCES "public"."FleetReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AiExtraction" ADD CONSTRAINT "AiExtraction_fleetReplyId_fkey" FOREIGN KEY ("fleetReplyId") REFERENCES "public"."FleetReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverDetailConfirmation" ADD CONSTRAINT "DriverDetailConfirmation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverDetailConfirmation" ADD CONSTRAINT "DriverDetailConfirmation_fleetReplyId_fkey" FOREIGN KEY ("fleetReplyId") REFERENCES "public"."FleetReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DispatchBatchOrder" ADD CONSTRAINT "DispatchBatchOrder_dispatchBatchId_fkey" FOREIGN KEY ("dispatchBatchId") REFERENCES "public"."DispatchBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DispatchBatchOrder" ADD CONSTRAINT "DispatchBatchOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."IwayReturnBatchOrder" ADD CONSTRAINT "IwayReturnBatchOrder_iwayReturnBatchId_fkey" FOREIGN KEY ("iwayReturnBatchId") REFERENCES "public"."IwayReturnBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."IwayReturnBatchOrder" ADD CONSTRAINT "IwayReturnBatchOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActivityLog" ADD CONSTRAINT "ActivityLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
