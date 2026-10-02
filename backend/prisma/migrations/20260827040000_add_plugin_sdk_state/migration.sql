CREATE TABLE "PluginMigration" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "pluginVersion" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "destructive" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PluginMigration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluginSetting" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PluginSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluginJobDefinition" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PluginJobDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluginJobRun" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "PluginJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginMigration_pluginId_migrationId_key" ON "PluginMigration"("pluginId", "migrationId");
CREATE INDEX "PluginMigration_pluginId_appliedAt_idx" ON "PluginMigration"("pluginId", "appliedAt");
CREATE UNIQUE INDEX "PluginSetting_pluginId_key_key" ON "PluginSetting"("pluginId", "key");
CREATE UNIQUE INDEX "PluginJobDefinition_pluginId_jobId_key" ON "PluginJobDefinition"("pluginId", "jobId");
CREATE INDEX "PluginJobDefinition_enabled_lastStartedAt_idx" ON "PluginJobDefinition"("enabled", "lastStartedAt");
CREATE INDEX "PluginJobRun_pluginId_jobId_startedAt_idx" ON "PluginJobRun"("pluginId", "jobId", "startedAt");
