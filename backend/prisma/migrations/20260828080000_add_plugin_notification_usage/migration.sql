CREATE TABLE "PluginNotificationUsage" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PluginNotificationUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginNotificationUsage_pluginId_windowStart_key" ON "PluginNotificationUsage"("pluginId", "windowStart");
