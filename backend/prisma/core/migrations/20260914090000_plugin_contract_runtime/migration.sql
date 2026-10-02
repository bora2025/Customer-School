CREATE TABLE "PluginOutboxEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "pluginId" TEXT NOT NULL, "eventName" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL,
  "subjectKey" TEXT NOT NULL, "payloadJson" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3), CONSTRAINT "PluginOutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PluginOutboxEvent_pluginId_idempotencyKey_key" ON "PluginOutboxEvent"("pluginId", "idempotencyKey");
CREATE INDEX "PluginOutboxEvent_status_availableAt_idx" ON "PluginOutboxEvent"("status", "availableAt");
CREATE TABLE "PluginProcessedEvent" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "eventId" UUID NOT NULL, "consumerPluginId" TEXT NOT NULL, "consumerId" TEXT NOT NULL, "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PluginProcessedEvent_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "PluginProcessedEvent_eventId_consumerPluginId_consumerId_key" ON "PluginProcessedEvent"("eventId", "consumerPluginId", "consumerId");
CREATE TABLE "PluginDeadLetter" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "eventId" UUID NOT NULL, "consumerPluginId" TEXT NOT NULL, "consumerId" TEXT NOT NULL, "error" TEXT NOT NULL, "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "replayedAt" TIMESTAMP(3), CONSTRAINT "PluginDeadLetter_pkey" PRIMARY KEY ("id"));
CREATE INDEX "PluginDeadLetter_consumerPluginId_failedAt_idx" ON "PluginDeadLetter"("consumerPluginId", "failedAt");
CREATE TABLE "PluginReadModel" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "ownerPluginId" TEXT NOT NULL, "modelName" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL, "recordKey" TEXT NOT NULL, "dataJson" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PluginReadModel_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "PluginReadModel_ownerPluginId_modelName_recordKey_key" ON "PluginReadModel"("ownerPluginId", "modelName", "recordKey");
CREATE INDEX "PluginReadModel_modelName_updatedAt_idx" ON "PluginReadModel"("modelName", "updatedAt");
